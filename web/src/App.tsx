import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Command, Device, DevicesResponse, Kind } from '../../api/src/types';
import { AuthError, fetchDevices, sendCommand } from './api';
import { handleRedirect, isLoggedIn, login, logout } from './auth';
import { DeviceCard } from './components/DeviceCard';
import { SensorStrip } from './components/SensorStrip';
import { loadConfig } from './config';

const POLL_MS = 2 * 60_000; // API の回数制限があるので控えめに

const SECTIONS: { kinds: Kind[]; title: string }[] = [
  { kinds: ['aircon'], title: 'エアコン' },
  { kinds: ['light'], title: '照明' },
  { kinds: ['switch', 'bot'], title: 'スイッチ・家電' },
  { kinds: ['curtain'], title: 'カーテン' },
  { kinds: ['tv', 'ir'], title: 'テレビ・リモコン' },
];

type Phase = { name: 'loading' } | { name: 'login' } | { name: 'ready' } | { name: 'error'; message: string };

export function App() {
  const [phase, setPhase] = useState<Phase>({ name: 'loading' });

  useEffect(() => {
    (async () => {
      try {
        await loadConfig();
        await handleRedirect();
        setPhase(isLoggedIn() ? { name: 'ready' } : { name: 'login' });
      } catch (e) {
        setPhase({ name: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    })();
  }, []);

  if (phase.name === 'loading') return <div className="center muted">読み込み中…</div>;
  if (phase.name === 'error') {
    return (
      <div className="center">
        <p className="error-text">{phase.message}</p>
        <button className="btn" onClick={() => location.reload()}>再読み込み</button>
      </div>
    );
  }
  if (phase.name === 'login') {
    return (
      <div className="center login">
        <img src="/icon.svg" alt="" width={64} height={64} />
        <h1>おうちダッシュボード</h1>
        <button className="btn btn-primary btn-wide" onClick={() => void login()}>ログイン</button>
      </div>
    );
  }
  return <Dashboard onAuthError={() => setPhase({ name: 'login' })} />;
}

function applyOptimistic(device: Device, command: Command): Device {
  const state = { ...device.state };
  switch (command.action) {
    case 'on':
    case 'off':
      state.power = command.action;
      break;
    case 'open':
      state.position = 0;
      break;
    case 'close':
      state.position = 100;
      break;
    case 'aircon':
      state.power = command.power;
      if (command.mode) state.mode = command.mode;
      if (command.temperature !== undefined) state.targetTemperature = command.temperature;
      break;
  }
  return { ...device, state };
}

function Dashboard({ onAuthError }: { onAuthError: () => void }) {
  const [data, setData] = useState<DevicesResponse | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);

  const showToast = useCallback((text: string, error = false) => {
    setToast({ text, error });
    window.setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 3500);
  }, []);

  const handleError = useCallback(
    (e: unknown) => {
      if (e instanceof AuthError) return onAuthError();
      showToast(e instanceof Error ? e.message : String(e), true);
    },
    [onAuthError, showToast],
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setData(await fetchDevices());
    } catch (e) {
      handleError(e);
    } finally {
      setRefreshing(false);
    }
  }, [handleError]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const onCommand = useCallback(
    async (device: Device, command: Command) => {
      try {
        await sendCommand(device.id, command);
        setData((d) => d && { ...d, devices: d.devices.map((x) => (x.id === device.id ? applyOptimistic(x, command) : x)) });
        showToast(`${device.name} を操作しました`);
      } catch (e) {
        handleError(e);
      }
    },
    [handleError, showToast],
  );

  const sensors = useMemo(() => data?.devices.filter((d) => d.kind === 'sensor') ?? [], [data]);
  const updated = data ? new Date(data.fetchedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : null;

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>おうち</h1>
          {updated && <p className="muted small">{updated} 更新</p>}
        </div>
        <div className="topbar-actions">
          <button className="btn btn-small" onClick={() => void refresh()} disabled={refreshing}>
            {refreshing ? '更新中…' : '更新'}
          </button>
          <button className="btn btn-small btn-ghost" onClick={logout}>ログアウト</button>
        </div>
      </header>

      {data?.errors.map((e) => (
        <p key={e.provider} className="banner">
          {e.provider === 'remo' ? 'Nature Remo' : 'SwitchBot'}: {e.message}
        </p>
      ))}

      {!data && <p className="muted center-text">機器を読み込み中…</p>}

      <SensorStrip sensors={sensors} />

      {SECTIONS.map(({ kinds, title }) => {
        const devices = data?.devices.filter((d) => kinds.includes(d.kind)) ?? [];
        if (!devices.length) return null;
        return (
          <section key={title} className="section">
            <h2>{title}</h2>
            <div className="grid">
              {devices.map((d) => (
                <DeviceCard key={d.id} device={d} onCommand={onCommand} />
              ))}
            </div>
          </section>
        );
      })}

      {data && data.devices.length === 0 && data.errors.length === 0 && (
        <p className="muted center-text">操作できる機器が見つかりませんでした</p>
      )}

      {toast && (
        <div className={`toast${toast.error ? ' toast-error' : ''}`} role="status">
          {toast.text}
        </div>
      )}
    </div>
  );
}
