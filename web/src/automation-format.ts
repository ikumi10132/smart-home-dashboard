import { sortByRemote } from './button-layout';
import type { AirconMode, Automation, Command, Condition, Device, StateCondition, Trigger, Weekday } from '../../api/src/types';

export const WEEKDAYS: { day: Weekday; label: string }[] = [
  { day: 1, label: '月' },
  { day: 2, label: '火' },
  { day: 3, label: '水' },
  { day: 4, label: '木' },
  { day: 5, label: '金' },
  { day: 6, label: '土' },
  { day: 0, label: '日' },
];

export const DAY_PRESETS: { label: string; days: Weekday[] }[] = [
  { label: '毎日', days: [0, 1, 2, 3, 4, 5, 6] },
  { label: '平日', days: [1, 2, 3, 4, 5] },
  { label: '週末', days: [0, 6] },
];

export const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
/** 5 分単位 */
export const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));

export const COOLDOWN_CHOICES: { minutes: number; label: string }[] = [
  { minutes: 0, label: 'なし' },
  { minutes: 15, label: '15 分' },
  { minutes: 30, label: '30 分' },
  { minutes: 60, label: '1 時間' },
  { minutes: 120, label: '2 時間' },
  { minutes: 180, label: '3 時間' },
  { minutes: 360, label: '6 時間' },
];

export const MODE_LABEL: Record<AirconMode, string> = {
  auto: '自動',
  cool: '冷房',
  heat: '暖房',
  dry: '除湿',
  fan: '送風',
};

export const METRIC_LABEL = { temperature: '温度', humidity: '湿度' } as const;
export const METRIC_UNIT = { temperature: '℃', humidity: '%' } as const;

const sameDays = (a: Weekday[], b: Weekday[]) => a.length === b.length && b.every((d) => a.includes(d));

export function describeDays(days: Weekday[]): string {
  const preset = DAY_PRESETS.find((p) => sameDays(days, p.days));
  if (preset) return preset.label;
  return WEEKDAYS.filter((w) => days.includes(w.day)).map((w) => w.label).join('・');
}

// ---------- 機器の候補 ----------

export interface CommandOption {
  label: string;
  command: Command;
}

/** エアコン以外の機器で選べる操作 (ダッシュボードのボタンと同じもの) */
export function commandOptions(device: Device): CommandOption[] {
  const buttons = sortByRemote(device.buttons ?? [], (b) => b.label).map((b) => ({ label: b.label, command: { action: 'button', button: b.name } as Command }));
  switch (device.kind) {
    case 'light':
    case 'switch':
      return [{ label: 'ON', command: { action: 'on' } }, { label: 'OFF', command: { action: 'off' } }, ...buttons];
    case 'curtain':
      return [{ label: '開ける', command: { action: 'open' } }, { label: '閉める', command: { action: 'close' } }];
    case 'bot':
      return [{ label: '押す', command: { action: 'press' } }];
    case 'tv':
    case 'ir':
      return buttons;
    default:
      return [];
  }
}

/** 操作できる機器 */
export const actionDevices = (devices: Device[]) => devices.filter((d) => d.kind === 'aircon' || commandOptions(d).length > 0);
/** 温度・湿度を読める機器 */
export const sensorDevices = (devices: Device[]) =>
  devices.filter((d) => d.state.temperature !== undefined || d.state.humidity !== undefined);
/** ON / OFF を読める機器 (赤外線の照明などは最後に送った操作しか分からないので除く。エアコンは使える) */
export const powerDevices = (devices: Device[]) =>
  devices.filter((d) => d.state.power !== undefined && (!d.infrared || d.kind === 'aircon'));

export const metricsOf = (d: Device) =>
  (['temperature', 'humidity'] as const).filter((m) => d.state[m] !== undefined);

// ---------- 説明文 ----------

export const commandKey = (c: Command) => JSON.stringify(c);

export function describeCommand(command: Command, device?: Device): string {
  if (command.action === 'aircon') {
    if (command.power === 'off') return '停止';
    const mode = command.mode ? MODE_LABEL[command.mode] : '';
    const temp = command.temperature !== undefined ? ` ${command.temperature}℃` : '';
    return `${mode}${temp}で運転`;
  }
  const option = device && commandOptions(device).find((o) => commandKey(o.command) === commandKey(command));
  if (option) return option.label;
  switch (command.action) {
    case 'on':
      return 'ON';
    case 'off':
      return 'OFF';
    case 'open':
      return '開ける';
    case 'close':
      return '閉める';
    case 'press':
      return '押す';
    case 'button':
      return command.button;
  }
}

type Names = Map<string, Device>;
const nameOf = (c: { deviceId: string; deviceName: string }, devices: Names) => devices.get(c.deviceId)?.name ?? c.deviceName;

export function describeState(c: StateCondition, devices: Names): string {
  if (c.type === 'power') return `${nameOf(c, devices)} が ${c.power.toUpperCase()}`;
  return `${nameOf(c, devices)} の${METRIC_LABEL[c.metric]}が ${c.value}${METRIC_UNIT[c.metric]} ${c.op === 'above' ? '以上' : '以下'}`;
}

export function describeTrigger(t: Trigger, devices: Names): string {
  return t.type === 'time' ? `${describeDays(t.days)} ${t.time}` : `${describeState(t.condition, devices)}になったら`;
}

export function describeCondition(c: Condition, devices: Names): string {
  switch (c.type) {
    case 'timeRange':
      return `${c.from}〜${c.to} の間`;
    case 'days':
      return `${describeDays(c.days)}`;
    default:
      return `${describeState(c, devices)}のとき`;
  }
}

export const conditionDeviceIds = (a: Pick<Automation, 'trigger' | 'conditions'>) =>
  [...(a.trigger.type === 'state' ? [a.trigger.condition] : []), ...a.conditions].flatMap((c) =>
    'deviceId' in c ? [c.deviceId] : [],
  );

// ---------- 初期値 ----------

export function defaultCommand(device: Device): Command {
  if (device.kind === 'aircon') {
    const modes = device.aircon?.modes ?? [];
    const mode: AirconMode = modes.includes('cool') ? 'cool' : (modes[0] ?? 'cool');
    const temps = device.aircon?.temperatures[mode] ?? [];
    return { action: 'aircon', power: 'on', mode, temperature: temps.length ? nearest(temps, 26) : undefined };
  }
  return commandOptions(device)[0]?.command ?? { action: 'on' };
}

/** 状態の条件の初期値。使える機器がなければ undefined */
export function defaultStateCondition(type: 'sensor' | 'power', devices: Device[]): StateCondition | undefined {
  if (type === 'sensor') {
    const d = sensorDevices(devices)[0];
    if (!d) return undefined;
    const metric = metricsOf(d)[0]!;
    return { type: 'sensor', deviceId: d.id, deviceName: d.name, metric, op: 'above', value: metric === 'temperature' ? 28 : 60 };
  }
  const d = powerDevices(devices)[0];
  return d && { type: 'power', deviceId: d.id, deviceName: d.name, power: 'on' };
}

export function nearest(values: number[], target: number): number {
  return values.reduce((best, v) => (Math.abs(v - target) < Math.abs(best - target) ? v : best), values[0]!);
}
