// オートメーションの入力チェックと「いま実行するか」の判定 (AWS を使わない部分。テストしやすいように分けている)
import { validateCommand } from './clients.js';
import type {
  Automation,
  AutomationInput,
  Condition,
  DeviceState,
  ScheduleAction,
  StateCondition,
  Trigger,
  Weekday,
} from './types.js';

/** 日本時間 (UTC+9、夏時間なし) */
const TZ_OFFSET_MS = 9 * 60 * 60_000;
/** 判定は 5 分ごと。時刻も 5 分単位で指定する */
export const STEP_MINUTES = 5;
/** Lambda の起動が遅れても、この分数までは取り戻して実行する (5 分ごとの起動を 1 回逃しても間に合う) */
export const GRACE_MINUTES = 10;
export const MAX_AUTOMATIONS = 50;
export const MAX_ACTIONS = 10;
export const MAX_CONDITIONS = 5;
export const COOLDOWN_CHOICES = [0, 15, 30, 60, 120, 180, 360];

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DEVICE_RE = /^(switchbot|remo):.+$/;

// ---------- 入力チェック ----------

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});

function checkTime(v: unknown, label: string): string {
  const m = typeof v === 'string' ? TIME_RE.exec(v) : null;
  if (!m || Number(m[2]) % STEP_MINUTES !== 0) throw new Error(`${label}は 5 分単位の HH:MM で指定してください`);
  return v as string;
}

function checkDays(v: unknown): Weekday[] {
  if (!Array.isArray(v) || !v.length || v.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    throw new Error('曜日を 1 つ以上選んでください');
  }
  return [...new Set(v as Weekday[])].sort();
}

function checkDevice(x: Obj): { deviceId: string; deviceName: string } {
  if (typeof x.deviceId !== 'string' || !DEVICE_RE.test(x.deviceId) || x.deviceId.length > 200) {
    throw new Error('機器が不正です');
  }
  const deviceName = typeof x.deviceName === 'string' && x.deviceName ? x.deviceName.slice(0, 60) : x.deviceId;
  return { deviceId: x.deviceId, deviceName };
}

function checkStateCondition(v: unknown): StateCondition {
  const x = obj(v);
  if (x.type === 'sensor') {
    if (x.metric !== 'temperature' && x.metric !== 'humidity') throw new Error('センサーの種類が不正です');
    if (x.op !== 'above' && x.op !== 'below') throw new Error('「以上 / 以下」が不正です');
    const [min, max] = x.metric === 'temperature' ? [-30, 60] : [0, 100];
    if (typeof x.value !== 'number' || !Number.isFinite(x.value) || x.value < min || x.value > max) {
      throw new Error(`${x.metric === 'temperature' ? '温度' : '湿度'}の値は ${min}〜${max} で指定してください`);
    }
    return { type: 'sensor', ...checkDevice(x), metric: x.metric, op: x.op, value: Math.round(x.value * 10) / 10 };
  }
  if (x.type === 'power') {
    if (x.power !== 'on' && x.power !== 'off') throw new Error('ON / OFF が不正です');
    return { type: 'power', ...checkDevice(x), power: x.power };
  }
  throw new Error('条件の種類が不正です');
}

function checkCondition(v: unknown): Condition {
  const x = obj(v);
  if (x.type === 'timeRange') {
    const from = checkTime(x.from, '時間帯');
    const to = checkTime(x.to, '時間帯');
    if (from === to) throw new Error('時間帯の始まりと終わりが同じです');
    return { type: 'timeRange', from, to };
  }
  if (x.type === 'days') return { type: 'days', days: checkDays(x.days) };
  return checkStateCondition(v);
}

function checkTrigger(v: unknown): Trigger {
  const x = obj(v);
  if (x.type === 'time') return { type: 'time', days: checkDays(x.days), time: checkTime(x.time, '時刻') };
  if (x.type === 'state') return { type: 'state', condition: checkStateCondition(x.condition) };
  throw new Error('きっかけが不正です');
}

export function validateAutomation(value: unknown): AutomationInput {
  const v = obj(value);
  const name = typeof v.name === 'string' ? v.name.trim() : '';
  if (!name || name.length > 40) throw new Error('名前は 1〜40 文字で入力してください');
  if (typeof v.enabled !== 'boolean') throw new Error('enabled が不正です');
  const trigger = checkTrigger(v.trigger);
  const rawConditions = v.conditions ?? [];
  if (!Array.isArray(rawConditions)) throw new Error('条件が不正です');
  if (rawConditions.length > MAX_CONDITIONS) throw new Error(`条件は ${MAX_CONDITIONS} 個までです`);
  const conditions = rawConditions.map(checkCondition);
  if (!Array.isArray(v.actions) || !v.actions.length) throw new Error('操作を 1 つ以上追加してください');
  if (v.actions.length > MAX_ACTIONS) throw new Error(`操作は ${MAX_ACTIONS} 個までです`);
  const actions: ScheduleAction[] = v.actions.map((a: unknown) => {
    const x = obj(a);
    return { ...checkDevice(x), command: validateCommand(x.command) };
  });
  const cooldownMinutes = v.cooldownMinutes ?? 30;
  if (typeof cooldownMinutes !== 'number' || !COOLDOWN_CHOICES.includes(cooldownMinutes)) {
    throw new Error('連続して動かさない時間が不正です');
  }
  return { name, enabled: v.enabled, trigger, conditions, actions, cooldownMinutes };
}

// ---------- 判定 ----------

/** 日本時間の曜日・日付・時刻 */
function local(t: Date) {
  const d = new Date(t.getTime() + TZ_OFFSET_MS);
  const iso = d.toISOString();
  return { day: d.getUTCDay() as Weekday, date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

/** 判定に使う機器 (状態を API から読む必要があるもの) */
export function stateDeviceIds(a: Pick<AutomationInput, 'trigger' | 'conditions'>): string[] {
  const all = [...(a.trigger.type === 'state' ? [a.trigger.condition] : []), ...a.conditions];
  return all.flatMap((c) => (c.type === 'sensor' || c.type === 'power' ? [c.deviceId] : []));
}

/** 条件を満たすか。機器の状態が読めないときは undefined (分からない) */
export function checkConditionNow(c: Condition, states: Map<string, DeviceState>, now: Date): boolean | undefined {
  const l = local(now);
  switch (c.type) {
    case 'days':
      return c.days.includes(l.day);
    case 'timeRange':
      // from <= to なら [from, to)、from > to なら日付をまたぐ
      return c.from <= c.to ? l.time >= c.from && l.time < c.to : l.time >= c.from || l.time < c.to;
    case 'sensor': {
      const v = states.get(c.deviceId)?.[c.metric];
      if (v === undefined) return undefined;
      return c.op === 'above' ? v >= c.value : v <= c.value;
    }
    case 'power': {
      const p = states.get(c.deviceId)?.power;
      return p === undefined ? undefined : p === c.power;
    }
  }
}

/**
 * 時刻がきっかけのとき、いま実行するべき回のキー ("2026-11-28T07:00") を返す。
 * 同じキーで実行済み・時刻を過ぎてから保存した・遅れすぎた ときは null。
 */
export function dueRunKey(
  trigger: Extract<Trigger, { type: 'time' }>,
  updatedAt: string,
  lastRunKey: string | undefined,
  now: Date,
): string | null {
  const nowMinute = Math.floor(now.getTime() / 60_000) * 60_000;
  for (let m = 0; m < GRACE_MINUTES; m++) {
    const t = new Date(nowMinute - m * 60_000);
    const l = local(t);
    if (l.time !== trigger.time || !trigger.days.includes(l.day)) continue;
    const key = `${l.date}T${l.time}`;
    if (key === lastRunKey) return null;
    if (t.getTime() < new Date(updatedAt).getTime()) return null;
    return key;
  }
  return null;
}

export interface StoredFields {
  /** 最後に実行 (または判定) した回。二重実行を防ぐ */
  lastRunKey?: string;
  /** 状態がきっかけのとき、前回の判定できっかけを満たしていたか。未判定なら undefined */
  triggerMet?: boolean;
}

export interface Decision {
  /** 実行する回のキー */
  runKey?: string;
  /** 実行はしないが「判定済み」として記録する回のキー (時刻は来たが条件を満たさなかった) */
  skipKey?: string;
  /** 記録し直す triggerMet (変わったときだけ) */
  triggerMet?: boolean;
}

export function decide(a: Automation & StoredFields, states: Map<string, DeviceState>, now: Date): Decision {
  if (!a.enabled) return {};
  const conditionsMet = () => a.conditions.every((c) => checkConditionNow(c, states, now) === true);

  if (a.trigger.type === 'time') {
    const key = dueRunKey(a.trigger, a.updatedAt, a.lastRunKey, now);
    if (!key) return {};
    return conditionsMet() ? { runKey: key } : { skipKey: key };
  }

  const met = checkConditionNow(a.trigger.condition, states, now);
  if (met === undefined) return {}; // 状態が読めないときは何もしない (前回の判定も変えない)
  const decision: Decision = met !== a.triggerMet ? { triggerMet: met } : {};
  // 保存してから最初の判定は記録するだけ (保存した時点ですでに満たしていても急に動かない)
  if (!met || a.triggerMet !== false) return decision;
  if (!conditionsMet()) return decision;
  if (a.lastRun && now.getTime() - new Date(a.lastRun.at).getTime() < a.cooldownMinutes * 60_000) return decision;
  const slot = Math.floor(now.getTime() / (STEP_MINUTES * 60_000)) * STEP_MINUTES * 60_000;
  return { ...decision, runKey: `state:${new Date(slot).toISOString()}` };
}
