import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runActions } from '../src/clients.js';
import { dueRunKey, validateSchedule } from '../src/schedule.js';

// 2026-11-30 は月曜日。日本時間 07:00 = UTC 前日 22:00
const at = (jst: string) => new Date(`${jst}+09:00`);
const base = { enabled: true, days: [1, 2, 3, 4, 5] as (0 | 1 | 2 | 3 | 4 | 5 | 6)[], time: '07:00', updatedAt: '2026-11-01T00:00:00Z' };

test('曜日と日本時間の時刻が合えば実行する', () => {
  assert.equal(dueRunKey(base, undefined, at('2026-11-30T07:00:20')), '2026-11-30T07:00');
  assert.equal(dueRunKey(base, undefined, at('2026-11-30T06:59:59')), null);
  assert.equal(dueRunKey(base, undefined, at('2026-11-29T07:00:00')), null); // 日曜は対象外
  assert.equal(dueRunKey({ ...base, enabled: false }, undefined, at('2026-11-30T07:00:00')), null);
});

test('起動が数分遅れても取り戻すが、遅れすぎたら実行しない', () => {
  assert.equal(dueRunKey(base, undefined, at('2026-11-30T07:04:00')), '2026-11-30T07:00');
  assert.equal(dueRunKey(base, undefined, at('2026-11-30T07:05:00')), null);
});

test('同じ回は二度実行しない', () => {
  assert.equal(dueRunKey(base, '2026-11-30T07:00', at('2026-11-30T07:01:00')), null);
  assert.equal(dueRunKey(base, '2026-11-27T07:00', at('2026-11-30T07:01:00')), '2026-11-30T07:00');
});

test('時刻を過ぎてから保存したスケジュールは、その回は実行しない', () => {
  const saved = { ...base, updatedAt: at('2026-11-30T07:02:00').toISOString() };
  assert.equal(dueRunKey(saved, undefined, at('2026-11-30T07:03:00')), null);
  assert.equal(dueRunKey(saved, undefined, at('2026-12-01T07:00:00')), '2026-12-01T07:00');
});

test('日付をまたぐ時刻 (日本時間 0:00 台) も正しい曜日で判定する', () => {
  const s = { ...base, days: [1] as 1[], time: '00:30' };
  assert.equal(dueRunKey(s, undefined, at('2026-11-30T00:30:00')), '2026-11-30T00:30');
  assert.equal(dueRunKey(s, undefined, at('2026-12-01T00:30:00')), null);
});

const valid = {
  name: ' 朝の暖房 ',
  enabled: true,
  days: [5, 1, 1],
  time: '06:45',
  actions: [{ deviceId: 'remo:abc', deviceName: 'エアコン', command: { action: 'aircon', power: 'on', mode: 'heat', temperature: 22 } }],
};

test('入力チェック', () => {
  const s = validateSchedule(valid);
  assert.equal(s.name, '朝の暖房');
  assert.deepEqual(s.days, [1, 5]);
  assert.throws(() => validateSchedule({ ...valid, time: '25:00' }));
  assert.throws(() => validateSchedule({ ...valid, days: [] }));
  assert.throws(() => validateSchedule({ ...valid, days: [7] }));
  assert.throws(() => validateSchedule({ ...valid, actions: [] }));
  assert.throws(() => validateSchedule({ ...valid, actions: [{ ...valid.actions[0], deviceId: 'other:x' }] }));
  assert.throws(() => validateSchedule({ ...valid, actions: [{ ...valid.actions[0], command: { action: 'explode' } }] }));
  assert.throws(() => validateSchedule({ ...valid, actions: [{ ...valid.actions[0], command: { action: 'aircon', power: 'on', mode: 'turbo' } }] }));
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
  assert.deepEqual(results, [
    { deviceName: 'A', ok: true },
    { deviceName: 'B', ok: false, message: '圏外' },
    { deviceName: 'C', ok: true },
  ]);
});
