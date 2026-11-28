import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide, dueRunKey, stateDeviceIds, validateAutomation } from '../src/automation.js';
import type { StoredFields } from '../src/automation.js';
import { runActions } from '../src/clients.js';
import type { Automation, DeviceState, StateCondition } from '../src/types.js';

// 2026-11-30 は月曜日
const at = (jst: string) => new Date(`${jst}+09:00`);
const timeTrigger = { type: 'time' as const, days: [1, 2, 3, 4, 5] as (0 | 1 | 2 | 3 | 4 | 5 | 6)[], time: '07:00' };
const OLD = '2026-11-01T00:00:00Z';
const action = { deviceId: 'remo:ac', deviceName: 'エアコン', command: { action: 'on' as const } };

const rule = (over: Partial<Automation & StoredFields> = {}): Automation & StoredFields => ({
  id: 'a',
  name: 'テスト',
  enabled: true,
  trigger: timeTrigger,
  conditions: [],
  actions: [action],
  cooldownMinutes: 30,
  updatedAt: OLD,
  ...over,
});

const hot: StateCondition = { type: 'sensor', deviceId: 'switchbot:meter', deviceName: '温湿度計', metric: 'temperature', op: 'above', value: 28 };
const temp = (t: number) => new Map<string, DeviceState>([['switchbot:meter', { temperature: t }]]);

// ---------- 時刻がきっかけ ----------

test('曜日と日本時間の時刻が合えば実行する', () => {
  assert.equal(dueRunKey(timeTrigger, OLD, undefined, at('2026-11-30T07:00:20')), '2026-11-30T07:00');
  assert.equal(dueRunKey(timeTrigger, OLD, undefined, at('2026-11-30T06:55:00')), null);
  assert.equal(dueRunKey(timeTrigger, OLD, undefined, at('2026-11-29T07:00:00')), null); // 日曜は対象外
});

test('5 分ごとの起動を 1 回逃しても取り戻すが、遅れすぎたら実行しない', () => {
  assert.equal(dueRunKey(timeTrigger, OLD, undefined, at('2026-11-30T07:05:00')), '2026-11-30T07:00');
  assert.equal(dueRunKey(timeTrigger, OLD, undefined, at('2026-11-30T07:10:00')), null);
});

test('同じ回は二度実行しない。時刻を過ぎてから保存したらその回は実行しない', () => {
  assert.equal(dueRunKey(timeTrigger, OLD, '2026-11-30T07:00', at('2026-11-30T07:05:00')), null);
  const saved = at('2026-11-30T07:02:00').toISOString();
  assert.equal(dueRunKey(timeTrigger, saved, undefined, at('2026-11-30T07:05:00')), null);
  assert.equal(dueRunKey(timeTrigger, saved, undefined, at('2026-12-01T07:00:00')), '2026-12-01T07:00');
});

test('日付をまたぐ時刻 (日本時間 0:00 台) も正しい曜日で判定する', () => {
  const t = { ...timeTrigger, days: [1] as 1[], time: '00:30' };
  assert.equal(dueRunKey(t, OLD, undefined, at('2026-11-30T00:30:00')), '2026-11-30T00:30');
  assert.equal(dueRunKey(t, OLD, undefined, at('2026-12-01T00:30:00')), null);
});

test('時刻がきっかけでも、条件を満たさなければ実行せず「判定済み」にする', () => {
  const r = rule({ conditions: [hot] });
  assert.deepEqual(decide(r, temp(29), at('2026-11-30T07:00:10')), { runKey: '2026-11-30T07:00' });
  assert.deepEqual(decide(r, temp(25), at('2026-11-30T07:00:10')), { skipKey: '2026-11-30T07:00' });
  assert.deepEqual(decide(r, new Map(), at('2026-11-30T07:00:10')), { skipKey: '2026-11-30T07:00' }); // 読めない
  assert.deepEqual(decide({ ...r, enabled: false }, temp(29), at('2026-11-30T07:00:10')), {});
});

// ---------- 状態がきっかけ ----------

const stateRule = (over: Partial<Automation & StoredFields> = {}) => rule({ trigger: { type: 'state', condition: hot }, ...over });
const now = at('2026-11-30T14:07:30');

test('満たしていない → 満たした、に変わったときだけ実行する', () => {
  assert.deepEqual(decide(stateRule({ triggerMet: false }), temp(28), now), {
    triggerMet: true,
    runKey: `state:${at('2026-11-30T14:05:00').toISOString()}`,
  });
  assert.deepEqual(decide(stateRule({ triggerMet: true }), temp(29), now), {}); // 満たしたまま: 何もしない
  assert.deepEqual(decide(stateRule({ triggerMet: true }), temp(27), now), { triggerMet: false }); // 下がった: 次に備える
  assert.deepEqual(decide(stateRule({ triggerMet: false }), temp(27), now), {});
});

test('保存してから最初の判定は記録するだけ (すでに満たしていても急に動かない)', () => {
  assert.deepEqual(decide(stateRule(), temp(30), now), { triggerMet: true });
  assert.deepEqual(decide(stateRule(), temp(20), now), { triggerMet: false });
});

test('状態が読めないときは何もせず、前回の判定も変えない', () => {
  assert.deepEqual(decide(stateRule({ triggerMet: false }), new Map(), now), {});
});

test('連続して動かさない時間の間は実行しない', () => {
  const lastRun = { at: at('2026-11-30T13:50:00').toISOString(), ok: true, results: [] };
  assert.deepEqual(decide(stateRule({ triggerMet: false, lastRun }), temp(29), now), { triggerMet: true });
  const longAgo = { ...lastRun, at: at('2026-11-30T13:30:00').toISOString() };
  assert.ok(decide(stateRule({ triggerMet: false, lastRun: longAgo }), temp(29), now).runKey);
  assert.ok(decide(stateRule({ triggerMet: false, lastRun, cooldownMinutes: 0 }), temp(29), now).runKey);
});

test('条件: 時間帯 (日付またぎ)・曜日・電源', () => {
  const night = { type: 'timeRange' as const, from: '22:00', to: '06:00' };
  const states = new Map<string, DeviceState>([...temp(29), ['switchbot:light', { power: 'off' }]]);
  const run = (conditions: Automation['conditions'], t: Date) => decide(stateRule({ triggerMet: false, conditions }), states, t).runKey !== undefined;
  assert.equal(run([night], at('2026-11-30T23:00:00')), true);
  assert.equal(run([night], at('2026-11-30T05:55:00')), true);
  assert.equal(run([night], at('2026-11-30T06:00:00')), false);
  assert.equal(run([night], at('2026-11-30T14:00:00')), false);
  assert.equal(run([{ type: 'days', days: [1] }], now), true);
  assert.equal(run([{ type: 'days', days: [0, 6] }], now), false);
  const lightOff = { type: 'power' as const, deviceId: 'switchbot:light', deviceName: '照明', power: 'off' as const };
  assert.equal(run([lightOff], now), true);
  assert.equal(run([{ ...lightOff, power: 'on' }], now), false);
  assert.equal(run([{ ...lightOff, deviceId: 'switchbot:unknown' }], now), false); // 読めない機器は満たさない扱い
});

test('判定に使う機器だけを読む', () => {
  const lightOff = { type: 'power' as const, deviceId: 'switchbot:light', deviceName: '照明', power: 'off' as const };
  assert.deepEqual(stateDeviceIds(stateRule({ conditions: [lightOff, { type: 'days', days: [1] }] })), ['switchbot:meter', 'switchbot:light']);
  assert.deepEqual(stateDeviceIds(rule()), []);
});

// ---------- 入力チェック ----------

const valid = {
  name: ' 暑くなったら冷房 ',
  enabled: true,
  trigger: { type: 'state', condition: hot },
  conditions: [{ type: 'timeRange', from: '08:00', to: '22:00' }, { type: 'days', days: [5, 1, 1] }],
  actions: [{ deviceId: 'remo:abc', deviceName: 'エアコン', command: { action: 'aircon', power: 'on', mode: 'cool', temperature: 26 } }],
  cooldownMinutes: 60,
};

test('入力チェック', () => {
  const a = validateAutomation(valid);
  assert.equal(a.name, '暑くなったら冷房');
  assert.deepEqual(a.conditions[1], { type: 'days', days: [1, 5] });
  assert.equal(validateAutomation({ ...valid, cooldownMinutes: undefined }).cooldownMinutes, 30);
  const bad = (over: object) => assert.throws(() => validateAutomation({ ...valid, ...over }));
  bad({ trigger: { type: 'time', days: [1], time: '07:03' } }); // 5 分単位でない
  bad({ trigger: { type: 'time', days: [], time: '07:00' } });
  bad({ trigger: { type: 'state', condition: { ...hot, op: 'equal' } } });
  bad({ trigger: { type: 'state', condition: { ...hot, metric: 'humidity', value: 120 } } });
  bad({ trigger: { type: 'state', condition: { type: 'timeRange', from: '08:00', to: '09:00' } } }); // 時間帯はきっかけにできない
  bad({ conditions: [{ type: 'timeRange', from: '08:00', to: '08:00' }] });
  bad({ conditions: Array(6).fill({ type: 'days', days: [1] }) });
  bad({ actions: [] });
  bad({ actions: [{ ...valid.actions[0], deviceId: 'other:x' }] });
  bad({ actions: [{ ...valid.actions[0], command: { action: 'explode' } }] });
  bad({ cooldownMinutes: 7 });
});

test('操作は順番に送り、1 つ失敗しても残りは続ける', async () => {
  const sent: string[] = [];
  const results = await runActions(
    [
      { deviceId: 'remo:a', deviceName: 'A', command: { action: 'on' } },
      { deviceId: 'remo:b', deviceName: 'B', command: { action: 'off' } },
      { deviceId: 'switchbot:c', deviceName: 'C', command: { action: 'press' } },
    ],
    async (id) => {
      sent.push(id);
      if (id === 'remo:b') throw new Error('圏外');
    },
    0,
  );
  assert.deepEqual(sent, ['remo:a', 'remo:b', 'switchbot:c']);
  assert.deepEqual(results.map((r) => r.ok), [true, false, true]);
  assert.equal(results[1]!.message, '圏外');
});
