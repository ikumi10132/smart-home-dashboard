import { cached, invalidate } from './cache.js';
import type { AirconMode, Command, Device, DeviceButton, DeviceState } from './types.js';

// https://developer.nature.global/
const BASE = 'https://api.nature.global/1';
const TTL = 60_000;

type RemoMode = 'cool' | 'warm' | 'dry' | 'blow' | 'auto';
const FROM_REMO: Record<RemoMode, AirconMode> = {
  cool: 'cool',
  warm: 'heat',
  dry: 'dry',
  blow: 'fan',
  auto: 'auto',
};
const TO_REMO: Record<AirconMode, RemoMode> = {
  cool: 'cool',
  heat: 'warm',
  dry: 'dry',
  fan: 'blow',
  auto: 'auto',
};

export interface RemoAppliance {
  id: string;
  type: string;
  nickname: string;
  model?: { name?: string } | null;
  settings?: { temp?: string; mode?: string; button?: string } | null;
  aircon?: { range?: { modes?: Record<string, { temp?: string[] }> } } | null;
  light?: { buttons?: DeviceButton[]; state?: { power?: string } } | null;
  tv?: { buttons?: DeviceButton[] } | null;
  signals?: { id: string; name: string }[];
}

export interface RemoDevice {
  id: string;
  name: string;
  newest_events?: Partial<Record<'te' | 'hu' | 'il' | 'mo', { val: number }>>;
}

const TV_LABELS: Record<string, string> = {
  power: '電源',
  'vol-up': '音量 +',
  'vol-down': '音量 −',
  'ch-up': 'CH +',
  'ch-down': 'CH −',
  mute: 'ミュート',
  input: '入力切替',
};

const isRemoMode = (m: string): m is RemoMode => m in FROM_REMO;

export function mapAppliance(a: RemoAppliance): Device | null {
  const base = {
    id: `remo:${a.id}`,
    provider: 'remo' as const,
    name: a.nickname,
    model: a.model?.name ?? undefined,
    infrared: true,
  };
  switch (a.type) {
    case 'AC': {
      const rangeModes = a.aircon?.range?.modes ?? {};
      const modes: AirconMode[] = [];
      const temperatures: Partial<Record<AirconMode, number[]>> = {};
      for (const [m, spec] of Object.entries(rangeModes)) {
        if (!isRemoMode(m)) continue;
        const mode = FROM_REMO[m];
        modes.push(mode);
        temperatures[mode] = (spec.temp ?? [])
          .filter((t) => t !== '' && !Number.isNaN(Number(t)))
          .map(Number);
      }
      const s = a.settings ?? {};
      const state: DeviceState = { power: s.button === 'power-off' ? 'off' : 'on' };
      if (s.mode && isRemoMode(s.mode)) state.mode = FROM_REMO[s.mode];
      if (s.temp && !Number.isNaN(Number(s.temp))) state.targetTemperature = Number(s.temp);
      return { ...base, kind: 'aircon', state, aircon: { modes, temperatures } };
    }
    case 'LIGHT': {
      const power = a.light?.state?.power;
      return {
        ...base,
        kind: 'light',
        state: power === 'on' || power === 'off' ? { power } : {},
        buttons: (a.light?.buttons ?? []).filter((b) => !['on', 'off', 'onoff'].includes(b.name)),
      };
    }
    case 'TV': {
      const buttons = (a.tv?.buttons ?? [])
        .filter((b) => b.name in TV_LABELS)
        .map((b) => ({ name: b.name, label: TV_LABELS[b.name] ?? b.label }));
      return { ...base, kind: 'tv', state: {}, buttons };
    }
    case 'IR': {
      const buttons = (a.signals ?? []).map((s) => ({ name: `signal:${s.id}`, label: s.name }));
      return buttons.length ? { ...base, kind: 'ir', state: {}, buttons } : null;
    }
    default:
      return null; // スマートメーター等は未対応
  }
}

export function mapSensor(d: RemoDevice): Device | null {
  const ev = d.newest_events ?? {};
  if (ev.te === undefined && ev.hu === undefined) return null; // Remo nano などセンサー非搭載
  const state: DeviceState = {};
  if (ev.te) state.temperature = ev.te.val;
  if (ev.hu) state.humidity = ev.hu.val;
  return {
    id: `remo:device:${d.id}`,
    provider: 'remo',
    name: d.name,
    kind: 'sensor',
    infrared: false,
    state,
  };
}

export class RemoClient {
  constructor(private readonly token: string) {}

  private async request<T>(path: string, form?: Record<string, string>): Promise<T> {
    const res = await fetch(BASE + path, {
      method: form ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
        ...(form && { 'Content-Type': 'application/x-www-form-urlencoded' }),
      },
      body: form ? new URLSearchParams(form) : undefined,
    });
    if (res.status === 429) throw new Error('Nature Remo API の回数制限に達しました (5分で30回)');
    if (!res.ok) throw new Error(`Nature Remo API HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  async listDevices(): Promise<Device[]> {
    const [appliances, devices] = await Promise.all([
      cached('remo:appliances', TTL, () => this.request<RemoAppliance[]>('/appliances')),
      cached('remo:devices', TTL, () => this.request<RemoDevice[]>('/devices')),
    ]);
    return [
      ...devices.map(mapSensor),
      ...appliances.map(mapAppliance),
    ].filter((d): d is Device => d !== null);
  }

  async send(applianceId: string, command: Command): Promise<void> {
    const id = encodeURIComponent(applianceId);
    switch (command.action) {
      case 'aircon': {
        const form: Record<string, string> = { button: command.power === 'off' ? 'power-off' : '' };
        if (command.power === 'on') {
          if (command.mode) form.operation_mode = TO_REMO[command.mode];
          if (command.temperature !== undefined) form.temperature = String(command.temperature);
        }
        await this.request(`/appliances/${id}/aircon_settings`, form);
        break;
      }
      case 'on':
      case 'off':
        await this.request(`/appliances/${id}/light`, { button: command.action });
        break;
      case 'button':
        if (command.button.startsWith('signal:')) {
          const signalId = encodeURIComponent(command.button.slice('signal:'.length));
          await this.request(`/signals/${signalId}/send`, {});
        } else {
          // TV または照明のボタン
          const appliances = await cached('remo:appliances', TTL, () =>
            this.request<RemoAppliance[]>('/appliances'),
          );
          const type = appliances.find((a) => a.id === applianceId)?.type;
          const path = type === 'TV' ? 'tv' : 'light';
          await this.request(`/appliances/${id}/${path}`, { button: command.button });
        }
        break;
      default:
        throw new Error(`Nature Remo では未対応の操作です: ${command.action}`);
    }
    invalidate('remo:appliances');
  }
}
