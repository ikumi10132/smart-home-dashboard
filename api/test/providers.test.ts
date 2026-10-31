import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { mapAppliance, mapSensor } from '../src/remo.js';
import { infraredKind, physicalKind, sign } from '../src/switchbot.js';

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
