import { useState } from 'react';
import type { AirconMode, Command, Device } from '../../../api/src/types';
import { KindIcon } from './Icons';

interface Props {
  device: Device;
  onCommand: (device: Device, command: Command) => Promise<void>;
}

const MODE_LABEL: Record<AirconMode, string> = {
  auto: '自動',
  cool: '冷房',
  heat: '暖房',
  dry: '除湿',
  fan: '送風',
};

const PROVIDER_LABEL = { switchbot: 'SwitchBot', remo: 'Nature Remo' } as const;

export function DeviceCard({ device, onCommand }: Props) {
  const [busy, setBusy] = useState(false);
  const run = async (command: Command) => {
    if (busy) return;
    setBusy(true);
    try {
      await onCommand(device, command);
    } finally {
      setBusy(false);
    }
  };
  const isOn = device.state.power === 'on';

  return (
    <article className={`card${isOn ? ' is-on' : ''}${busy ? ' is-busy' : ''}`} aria-busy={busy}>
      <header className="card-head">
        <div className="card-id">
          <span className="card-icon"><KindIcon kind={device.kind} /></span>
          <div>
            <h3 className="card-title">{device.name}</h3>
            <p className="card-meta">
              {PROVIDER_LABEL[device.provider]}
              {device.infrared && ' · 赤外線'}
            </p>
          </div>
        </div>
        {device.state.power && <span className={`pill${isOn ? ' pill-on' : ''}`}>{isOn ? 'ON' : 'OFF'}</span>}
      </header>
      <div className="card-body">
        <Controls device={device} run={run} busy={busy} />
      </div>
    </article>
  );
}

function Controls({ device, run, busy }: { device: Device; run: (c: Command) => void; busy: boolean }) {
  const { state } = device;
  switch (device.kind) {
    case 'aircon':
      return <AirconControls device={device} run={run} busy={busy} />;
    case 'light':
    case 'switch':
      return (
        <>
          {state.brightness !== undefined && <p className="readout">明るさ {state.brightness}%</p>}
          <PowerButtons run={run} busy={busy} power={state.power} />
          <ButtonGrid device={device} run={run} busy={busy} />
        </>
      );
    case 'curtain':
      return (
        <>
          {state.position !== undefined && <p className="readout">{100 - state.position}% 開いています</p>}
          <div className="btn-row">
            <button className="btn" disabled={busy} onClick={() => run({ action: 'open' })}>開ける</button>
            <button className="btn" disabled={busy} onClick={() => run({ action: 'close' })}>閉める</button>
          </div>
        </>
      );
    case 'bot':
      return (
        <div className="btn-row">
          <button className="btn btn-primary" disabled={busy} onClick={() => run({ action: 'press' })}>押す</button>
        </div>
      );
    case 'tv':
    case 'ir':
      return <ButtonGrid device={device} run={run} busy={busy} />;
    default:
      return null;
  }
}

function PowerButtons({ run, busy, power }: { run: (c: Command) => void; busy: boolean; power?: 'on' | 'off' }) {
  return (
    <div className="btn-row">
      <button className={`btn${power === 'on' ? ' btn-primary' : ''}`} disabled={busy} onClick={() => run({ action: 'on' })}>
        ON
      </button>
      <button className={`btn${power === 'off' ? ' btn-dark' : ''}`} disabled={busy} onClick={() => run({ action: 'off' })}>
        OFF
      </button>
    </div>
  );
}

// 3 列のマス目での固定位置 [行, 列]。SwitchBot のライトのボタンを、リモコンと同じ並びにする
const BUTTON_SLOTS: Record<string, [number, number]> = {
  暗く: [0, 1],
  明るく: [0, 3],
  暖色: [1, 1],
  白色: [1, 3],
  '30分切り': [2, 1],
  常夜灯: [2, 2],
  全灯: [2, 3],
};
const GRID_COLUMNS = 3;

/** 各ボタンの CSS Grid 上の位置を返す。ボタンがない行は詰め、位置が未定のボタンは下の行に順に並べる */
function placeButtons(labels: string[]): { gridRow: number; gridColumn: number }[] {
  const usedRows = [...new Set(labels.flatMap((l) => (BUTTON_SLOTS[l] ? [BUTTON_SLOTS[l][0]] : [])))].sort((a, b) => a - b);
  let extras = 0;
  return labels.map((label) => {
    const slot = BUTTON_SLOTS[label];
    if (slot) return { gridRow: usedRows.indexOf(slot[0]) + 1, gridColumn: slot[1] };
    const position = extras++;
    return {
      gridRow: usedRows.length + Math.floor(position / GRID_COLUMNS) + 1,
      gridColumn: (position % GRID_COLUMNS) + 1,
    };
  });
}

function ButtonGrid({ device, run, busy }: { device: Device; run: (c: Command) => void; busy: boolean }) {
  if (!device.buttons?.length) return null;
  const positions = placeButtons(device.buttons.map((b) => b.label));
  return (
    <div className="btn-grid">
      {device.buttons.map((b, i) => (
        <button
          key={b.name}
          className="btn btn-small"
          style={positions[i]}
          disabled={busy}
          onClick={() => run({ action: 'button', button: b.name })}
        >
          {b.label}
        </button>
      ))}
    </div>
  );
}

function rememberKey(id: string) {
  return `shd.aircon.${id}`;
}

function AirconControls({ device, run, busy }: { device: Device; run: (c: Command) => void; busy: boolean }) {
  const modes = device.aircon?.modes ?? [];
  const remembered = (() => {
    try {
      return JSON.parse(localStorage.getItem(rememberKey(device.id)) ?? 'null') as { mode: AirconMode; temperature?: number } | null;
    } catch {
      return null;
    }
  })();
  const [mode, setMode] = useState<AirconMode>(device.state.mode ?? remembered?.mode ?? (modes.includes('cool') ? 'cool' : modes[0] ?? 'cool'));
  const temps = device.aircon?.temperatures[mode] ?? [];
  const [temp, setTemp] = useState<number | undefined>(device.state.targetTemperature ?? remembered?.temperature ?? 26);

  const effectiveTemp = temps.length ? nearest(temps, temp ?? 26) : undefined;
  const idx = effectiveTemp === undefined ? -1 : temps.indexOf(effectiveTemp);

  const start = () => {
    try {
      localStorage.setItem(rememberKey(device.id), JSON.stringify({ mode, temperature: effectiveTemp }));
    } catch {
      /* noop */
    }
    run({ action: 'aircon', power: 'on', mode, temperature: effectiveTemp });
  };

  return (
    <>
      <div className="segmented" role="radiogroup" aria-label="運転モード">
        {modes.map((m) => (
          <button key={m} role="radio" aria-checked={m === mode} className={m === mode ? 'active' : ''} onClick={() => setMode(m)}>
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>
      {effectiveTemp !== undefined ? (
        <div className="stepper">
          <button className="btn btn-round" aria-label="温度を下げる" disabled={idx <= 0} onClick={() => setTemp(temps[idx - 1])}>−</button>
          <span className="stepper-value">
            {effectiveTemp}
            <small>℃</small>
          </span>
          <button className="btn btn-round" aria-label="温度を上げる" disabled={idx >= temps.length - 1} onClick={() => setTemp(temps[idx + 1])}>+</button>
        </div>
      ) : (
        <p className="readout muted">このモードは温度設定なし</p>
      )}
      <div className="btn-row btn-row-lead">
        <button className="btn btn-primary" disabled={busy} onClick={start}>この設定で運転</button>
        <button className="btn" disabled={busy} onClick={() => run({ action: 'aircon', power: 'off', mode, temperature: effectiveTemp })}>停止</button>
      </div>
    </>
  );
}

function nearest(values: number[], target: number): number {
  return values.reduce((best, v) => (Math.abs(v - target) < Math.abs(best - target) ? v : best), values[0]!);
}
