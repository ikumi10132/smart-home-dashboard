import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { mapAppliance, mapSensor } from '../src/remo.js';
import { costPeriod, fetchCosts, isFresh, summarize } from '../src/costs.js';
import { infraredKind, physicalKind, sceneButtons, sign } from '../src/switchbot.js';

test('SwitchBot の署名は HMAC-SHA256 の Base64', () => {
  const expected = createHmac('sha256', 'secret').update('token' + '1700000000000' + 'nonce').digest('base64');
  assert.equal(sign('token', 'secret', '1700000000000', 'nonce'), expected);
});

test('SwitchBot の機種を種類に変換する', () => {
  assert.equal(physicalKind('Plug Mini (JP)'), 'switch');
  assert.equal(physicalKind('Curtain3'), 'curtain');
  assert.equal(physicalKind('Hub 2'), 'sensor');
  assert.equal(physicalKind('Hub Mini'), null);
  assert.equal(physicalKind('Color Bulb'), 'light');
  assert.equal(infraredKind('Air Conditioner'), 'aircon');
  assert.equal(infraredKind('DIY Fan'), null);
});

test('機器名で始まるシーンをその機器のボタンにする', () => {
  const buttons = sceneButtons('シーリングライト', [
    { sceneId: 's1', sceneName: 'シーリングライト 全灯' },
    { sceneId: 's2', sceneName: 'シーリングライト　常夜灯' }, // 全角スペース
    { sceneId: 's3', sceneName: 'シーリングライト暖色' }, // スペースなし
    { sceneId: 's4', sceneName: 'シーリングライト 映画' }, // 既定の並びにない名前は最後
    { sceneId: 's5', sceneName: '外出' }, // 別のシーン
    { sceneId: 's6', sceneName: 'シーリングライト' }, // ボタン名なし
  ]);
  assert.deepEqual(buttons, [
    { name: 'scene:s3', label: '暖色' },
    { name: 'scene:s2', label: '常夜灯' },
    { name: 'scene:s1', label: '全灯' },
    { name: 'scene:s4', label: '映画' },
  ]);
});

test('Nature Remo のエアコンを変換する', () => {
  const device = mapAppliance({
    id: 'a1',
    type: 'AC',
    nickname: 'エアコン',
    settings: { temp: '27', mode: 'warm', button: '' },
    aircon: { range: { modes: { warm: { temp: ['20', '21', ''] }, blow: { temp: [''] } } } },
  });
  assert.ok(device);
  assert.equal(device.kind, 'aircon');
  assert.deepEqual(device.state, { power: 'on', mode: 'heat', targetTemperature: 27 });
  assert.deepEqual(device.aircon?.modes, ['heat', 'fan']);
  assert.deepEqual(device.aircon?.temperatures.heat, [20, 21]);
  assert.deepEqual(device.aircon?.temperatures.fan, []);
});

test('センサーのない Remo は表示しない', () => {
  assert.equal(mapSensor({ id: 'd', name: 'Remo nano', newest_events: {} }), null);
  assert.deepEqual(mapSensor({ id: 'd', name: 'Remo', newest_events: { te: { val: 22.5 } } })?.state, {
    temperature: 22.5,
  });
});

test('利用料の期間は先月 1 日から今日まで (UTC)', () => {
  assert.deepEqual(costPeriod(new Date('2026-01-15T03:00:00Z')), {
    start: '2025-12-01',
    thisMonth: '2026-01-01',
    end: '2026-01-15',
  });
});

test('利用料をサービス別にまとめる', () => {
  const group = (name: string, amount: string) => ({ Keys: [name], Metrics: { UnblendedCost: { Amount: amount, Unit: 'USD' } } });
  const summary = summarize(
    [
      { TimePeriod: { Start: '2025-12-01', End: '2026-01-01' }, Groups: [group('AWS Lambda', '0.5'), group('Amazon S3', '0.25')] },
      {
        TimePeriod: { Start: '2026-01-01', End: '2026-01-15' },
        Groups: [
          group('Amazon CloudFront', '0.004'), // 0.005 未満は省く
          group('AWS Cost Explorer', '0.02'),
          group('Amazon API Gateway', '0.111'),
        ],
      },
    ],
    { start: '2025-12-01', thisMonth: '2026-01-01' },
  );
  assert.equal(summary.currency, 'USD');
  assert.equal(summary.lastMonth.total, 0.75);
  assert.equal(summary.thisMonth.total, 0.13);
  assert.deepEqual(summary.thisMonth.services, [
    { name: 'Amazon API Gateway', amount: 0.11 },
    { name: 'AWS Cost Explorer', amount: 0.02 },
  ]);
});

test('Cost Explorer が使えなくてもプラン情報は返す', async () => {
  const denied = Object.assign(new Error('denied'), { name: 'AccessDeniedException' });
  const res = await fetchCosts(
    () => Promise.reject(denied),
    () => Promise.resolve({ type: 'FREE', remainingCredits: 180.5, creditUnit: 'USD' }),
  );
  assert.equal(res.thisMonth, undefined);
  assert.match(res.costsError ?? '', /権限がありません/);
  assert.equal(res.plan?.remainingCredits, 180.5);
  // 利用額が取れていないときは 1 時間で取り直す
  const now = new Date(res.fetchedAt).getTime();
  assert.equal(isFresh(res, now + 30 * 60_000), true);
  assert.equal(isFresh(res, now + 2 * 60 * 60_000), false);
});

test('両方失敗したらエラーにする', async () => {
  await assert.rejects(
    fetchCosts(() => Promise.reject(new Error('ce')), () => Promise.reject(new Error('ft'))),
    /ce/,
  );
});
