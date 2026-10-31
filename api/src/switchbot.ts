import { createHmac, randomUUID } from 'node:crypto';
import { cached, invalidate } from './cache.js';
import type { AirconMode, Command, Device, DeviceButton, DeviceState, Kind } from './types.js';

// https://github.com/OpenWonderLabs/SwitchBotAPI
const BASE = 'https://api.switch-bot.com/v1.1';
const LIST_TTL = 10 * 60_000;
const STATUS_TTL = 60_000;

interface PhysicalDevice {
  deviceId: string;
  deviceName: string;
  deviceType?: string;
}
interface InfraredDevice {
  deviceId: string;
  deviceName: string;
  remoteType: string;
}
interface DeviceList {
  deviceList: PhysicalDevice[];
  infraredRemoteList: InfraredDevice[];
}
export interface Scene {
  sceneId: string;
  sceneName: string;
}

const AIRCON_MODES: AirconMode[] = ['auto', 'cool', 'dry', 'fan', 'heat'];
const AIRCON_MODE_CODE: Record<AirconMode, number> = { auto: 1, cool: 2, dry: 3, fan: 4, heat: 5 };
const AIRCON_TEMPS = Array.from({ length: 15 }, (_, i) => 16 + i);

const TV_BUTTONS: DeviceButton[] = [
  { name: 'turnOn', label: '電源' },
  { name: 'volumeAdd', label: '音量 +' },
  { name: 'volumeSub', label: '音量 −' },
  { name: 'channelAdd', label: 'CH +' },
  { name: 'channelSub', label: 'CH −' },
  { name: 'setMute', label: 'ミュート' },
];

const LIGHT_BUTTONS: DeviceButton[] = [
  { name: 'brightnessDown', label: '暗く' },
  { name: 'brightnessUp', label: '明るく' },
];

// 赤外線リモコンの API にないボタン (調色・常夜灯など) は、SwitchBot アプリの手動シーンで実行する。
// 「<機器名> <ボタン名>」という名前のシーンを、その機器のボタンとして表示する。
const SCENE_PREFIX = 'scene:';
const SCENE_BUTTON_ORDER = ['暖色', '白色', '30分切り', '常夜灯', '全灯'];

export function sceneButtons(deviceName: string, scenes: Scene[]): DeviceButton[] {
  const rank = (label: string) => {
    const i = SCENE_BUTTON_ORDER.indexOf(label);
    return i === -1 ? SCENE_BUTTON_ORDER.length : i;
  };
  return scenes
    .flatMap((s) => {
      const name = s.sceneName.trim();
      if (!name.startsWith(deviceName)) return [];
      const label = name.slice(deviceName.length).trim();
      return label ? [{ name: `${SCENE_PREFIX}${s.sceneId}`, label }] : [];
    })
    .sort((a, b) => rank(a.label) - rank(b.label));
}

export function sign(token: string, secret: string, t: string, nonce: string): string {
  return createHmac('sha256', secret).update(token + t + nonce).digest('base64');
}

export function physicalKind(deviceType: string | undefined): Kind | null {
  if (!deviceType) return null;
  const t = deviceType.toLowerCase();
  if (t === 'hub 2' || t === 'hub 3') return 'sensor'; // 温湿度センサー内蔵
  if (t.startsWith('hub')) return null; // 操作対象ではないので非表示
  if (t.includes('curtain') || t.includes('roller shade') || t.includes('blind')) return 'curtain';
  if (t === 'bot') return 'bot';
  if (t.includes('meter') || t === 'woiosensor') return 'sensor';
  if (t.includes('light') || t.includes('bulb') || t.includes('lamp')) return 'light';
  if (
    t.includes('plug') ||
    t.includes('relay switch') ||
    t.includes('fan') ||
    t.includes('humidifier') ||
    t.includes('air purifier')
  ) {
    return 'switch';
  }
  return null;
}

export function infraredKind(remoteType: string): Kind | null {
  const t = remoteType.toLowerCase();
  if (t.startsWith('diy')) return null; // DIY リモコンはボタン名が取得できないため対象外
  if (t.includes('air conditioner')) return 'aircon';
  if (t === 'tv' || t === 'iptv' || t.includes('set top box') || t.includes('streamer')) return 'tv';
  if (t === 'light') return 'light';
  return 'switch';
}

function toState(status: Record<string, unknown>): DeviceState {
  const state: DeviceState = {};
  const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
  if (typeof status.power === 'string') {
    state.power = status.power.toLowerCase() === 'on' ? 'on' : 'off';
  }
  state.temperature = num(status.temperature);
  state.humidity = num(status.humidity);
  state.brightness = num(status.brightness);
  state.position = num(status.slidePosition);
  state.battery = num(status.battery);
  return Object.fromEntries(Object.entries(state).filter(([, v]) => v !== undefined));
}

export class SwitchBotClient {
  constructor(
    private readonly token: string,
    private readonly secret: string,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const t = Date.now().toString();
    const nonce = randomUUID();
    const res = await fetch(BASE + path, {
      ...init,
      headers: {
        Authorization: this.token,
        sign: sign(this.token, this.secret, t, nonce),
        nonce,
        t,
        'Content-Type': 'application/json; charset=utf8',
      },
    });
    if (!res.ok) throw new Error(`SwitchBot API HTTP ${res.status}`);
    const json = (await res.json()) as { statusCode: number; message: string; body: T };
    if (json.statusCode !== 100) {
      throw new Error(`SwitchBot API エラー (${json.statusCode}): ${json.message}`);
    }
    return json.body;
  }

  private async listScenes(): Promise<Scene[]> {
    try {
      return await cached('switchbot:scenes', LIST_TTL, () => this.request<Scene[]>('/scenes'));
    } catch (e) {
      // シーンが取れなくても機器の一覧と基本操作は使えるようにする
      console.warn('SwitchBot scenes error', e);
      return [];
    }
  }

  async listDevices(): Promise<Device[]> {
    const [list, scenes] = await Promise.all([
      cached('switchbot:list', LIST_TTL, () => this.request<DeviceList>('/devices')),
      this.listScenes(),
    ]);

    const physical = list.deviceList.flatMap((d) => {
      const kind = physicalKind(d.deviceType);
      return kind ? [{ d, kind }] : [];
    });

    const devices = await Promise.all(
      physical.map(async ({ d, kind }): Promise<Device> => {
        let state: DeviceState = {};
        try {
          const status = await cached(`switchbot:status:${d.deviceId}`, STATUS_TTL, () =>
            this.request<Record<string, unknown>>(`/devices/${d.deviceId}/status`),
          );
          state = toState(status);
        } catch (e) {
          console.warn('SwitchBot status error', d.deviceId, e);
        }
        return {
          id: `switchbot:${d.deviceId}`,
          provider: 'switchbot',
          name: d.deviceName,
          kind,
          model: d.deviceType,
          infrared: false,
          state,
        };
      }),
    );

    for (const r of list.infraredRemoteList) {
      const kind = infraredKind(r.remoteType);
      if (!kind) continue;
      const preset = kind === 'tv' ? TV_BUTTONS : kind === 'light' ? LIGHT_BUTTONS : [];
      const buttons = kind === 'aircon' ? [] : [...preset, ...sceneButtons(r.deviceName, scenes)];
      devices.push({
        id: `switchbot:${r.deviceId}`,
        provider: 'switchbot',
        name: r.deviceName,
        kind,
        model: r.remoteType,
        infrared: true,
        state: {},
        ...(kind === 'aircon' && {
          aircon: {
            modes: AIRCON_MODES,
            temperatures: Object.fromEntries(AIRCON_MODES.map((m) => [m, AIRCON_TEMPS])),
          },
        }),
        ...(buttons.length > 0 && { buttons }),
      });
    }
    return devices;
  }

  async send(deviceId: string, command: Command): Promise<void> {
    let body: { command: string; parameter: string; commandType: 'command' };
    switch (command.action) {
      case 'on':
      case 'open':
        body = { command: 'turnOn', parameter: 'default', commandType: 'command' };
        break;
      case 'off':
      case 'close':
        body = { command: 'turnOff', parameter: 'default', commandType: 'command' };
        break;
      case 'press':
        body = { command: 'press', parameter: 'default', commandType: 'command' };
        break;
      case 'button':
        if (command.button.startsWith(SCENE_PREFIX)) {
          const sceneId = command.button.slice(SCENE_PREFIX.length);
          if (!(await this.listScenes()).some((s) => s.sceneId === sceneId)) {
            throw new Error('シーンが見つかりません。SwitchBot アプリで確認してください');
          }
          await this.request(`/scenes/${encodeURIComponent(sceneId)}/execute`, { method: 'POST' });
          return;
        }
        if (
          ![...TV_BUTTONS, ...LIGHT_BUTTONS].some((b) => b.name === command.button) &&
          command.button !== 'turnOff'
        ) {
          throw new Error(`未対応のボタンです: ${command.button}`);
        }
        body = { command: command.button, parameter: 'default', commandType: 'command' };
        break;
      case 'aircon': {
        // parameter: "温度,モード,風量(1=自動),電源"
        const mode = AIRCON_MODE_CODE[command.mode ?? 'cool'];
        const temp = command.temperature ?? 26;
        body = {
          command: 'setAll',
          parameter: `${temp},${mode},1,${command.power}`,
          commandType: 'command',
        };
        break;
      }
    }
    await this.request(`/devices/${encodeURIComponent(deviceId)}/commands`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    invalidate(`switchbot:status:${deviceId}`);
  }
}
