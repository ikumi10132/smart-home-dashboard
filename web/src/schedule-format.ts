import type { AirconMode, Command, Device, Weekday } from '../../api/src/types';

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

export const MODE_LABEL: Record<AirconMode, string> = {
  auto: '自動',
  cool: '冷房',
  heat: '暖房',
  dry: '除湿',
  fan: '送風',
};

const sameDays = (a: Weekday[], b: Weekday[]) => a.length === b.length && b.every((d) => a.includes(d));

export function describeDays(days: Weekday[]): string {
  const preset = DAY_PRESETS.find((p) => sameDays(days, p.days));
  if (preset) return preset.label;
  return WEEKDAYS.filter((w) => days.includes(w.day)).map((w) => w.label).join('・');
}

export interface CommandOption {
  label: string;
  command: Command;
}

/** エアコン以外の機器で選べる操作 (ダッシュボードのボタンと同じもの) */
export function commandOptions(device: Device): CommandOption[] {
  const buttons = (device.buttons ?? []).map((b) => ({ label: b.label, command: { action: 'button', button: b.name } as Command }));
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

/** スケジュールで操作できる機器 (センサーやボタンのない機器は除く) */
export function schedulableDevices(devices: Device[]): Device[] {
  return devices.filter((d) => d.kind === 'aircon' || commandOptions(d).length > 0);
}

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

/** 機器を選んだときの最初の操作 */
export function defaultCommand(device: Device): Command {
  if (device.kind === 'aircon') {
    const modes = device.aircon?.modes ?? [];
    const mode: AirconMode = modes.includes('cool') ? 'cool' : (modes[0] ?? 'cool');
    const temps = device.aircon?.temperatures[mode] ?? [];
    return { action: 'aircon', power: 'on', mode, temperature: temps.length ? nearest(temps, 26) : undefined };
  }
  return commandOptions(device)[0]?.command ?? { action: 'on' };
}

export function nearest(values: number[], target: number): number {
  return values.reduce((best, v) => (Math.abs(v - target) < Math.abs(best - target) ? v : best), values[0]!);
}
