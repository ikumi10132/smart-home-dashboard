// スケジュールの入力チェックと「いま実行する時刻か」の判定 (AWS を使わない部分。テストしやすいように分けている)
import { validateCommand } from './clients.js';
import type { Schedule, ScheduleAction, ScheduleInput, Weekday } from './types.js';

/** 日本時間 (UTC+9、夏時間なし) */
const TZ_OFFSET_MS = 9 * 60 * 60_000;
/** Lambda の起動が遅れても、この分数までは取り戻して実行する */
export const GRACE_MINUTES = 5;
export const MAX_SCHEDULES = 50;
export const MAX_ACTIONS = 10;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateSchedule(value: unknown): ScheduleInput {
  const v = (value ?? {}) as Record<string, unknown>;
  const name = typeof v.name === 'string' ? v.name.trim() : '';
  if (!name || name.length > 40) throw new Error('名前は 1〜40 文字で入力してください');
  if (typeof v.enabled !== 'boolean') throw new Error('enabled が不正です');
  if (typeof v.time !== 'string' || !TIME_RE.test(v.time)) throw new Error('時刻は HH:MM の形で入力してください');
  if (!Array.isArray(v.days) || !v.days.length || v.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    throw new Error('曜日を 1 つ以上選んでください');
  }
  const days = [...new Set(v.days as Weekday[])].sort();
  if (!Array.isArray(v.actions) || !v.actions.length) throw new Error('操作を 1 つ以上追加してください');
  if (v.actions.length > MAX_ACTIONS) throw new Error(`操作は ${MAX_ACTIONS} 個までです`);
  const actions: ScheduleAction[] = v.actions.map((a: unknown) => {
    const x = (a ?? {}) as Record<string, unknown>;
    if (typeof x.deviceId !== 'string' || !/^(switchbot|remo):.+$/.test(x.deviceId) || x.deviceId.length > 200) {
      throw new Error('機器が不正です');
    }
    const deviceName = typeof x.deviceName === 'string' ? x.deviceName.slice(0, 60) : x.deviceId;
    return { deviceId: x.deviceId, deviceName, command: validateCommand(x.command) };
  });
  return { name, enabled: v.enabled, days, time: v.time, actions };
}

/** 日本時間の曜日・日付・時刻 */
function local(t: Date) {
  const d = new Date(t.getTime() + TZ_OFFSET_MS);
  const iso = d.toISOString();
  return { day: d.getUTCDay() as Weekday, date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

/**
 * いま実行するべきなら、その回を表すキー ("2026-11-28T07:00") を返す。
 * 同じキーで実行済みなら null (二重実行しない)。
 * 時刻を過ぎてから保存したスケジュールは、その回は実行しない (保存した直後に急に動かないように)。
 */
export function dueRunKey(s: Pick<Schedule, 'enabled' | 'days' | 'time' | 'updatedAt'>, lastRunKey: string | undefined, now: Date): string | null {
  if (!s.enabled) return null;
  const nowMinute = Math.floor(now.getTime() / 60_000) * 60_000;
  for (let m = 0; m < GRACE_MINUTES; m++) {
    const t = new Date(nowMinute - m * 60_000);
    const l = local(t);
    if (l.time !== s.time || !s.days.includes(l.day)) continue;
    const key = `${l.date}T${l.time}`;
    if (key === lastRunKey) return null;
    if (t.getTime() < new Date(s.updatedAt).getTime()) return null;
    return key;
  }
  return null;
}
