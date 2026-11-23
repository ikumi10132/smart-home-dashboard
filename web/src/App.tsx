import { useCallback, useEffect, useRef, useState } from 'react';
import type { Command, Device, DevicesResponse } from '../../api/src/types';
import { AuthError, fetchDevices, sendCommand } from './api';
import { handleRedirect, isLoggedIn, login, logout } from './auth';
import { Clock } from './components/Clock';
import { NavAll, NavApps, NavLogout, NavRefresh, NavRoom } from './components/Icons';
import { RoomPanel } from './components/RoomPanel';
import { TaskPanel } from './components/TaskPanel';
import { WeatherPanel } from './components/WeatherPanel';
import { getConfig, loadConfig } from './config';
import { fetchToday, lowBatteryDevices, reportBatteries, type MyTaskToday } from './mytask';
import { ROOMS } from './rooms';

const POLL_MS = 2 * 60_000; // API の回数制限があるので控えめに
const ROOM_KEY = 'shd.room';
const ALL_ROOMS = 'all';

function loadRoomFilter(): string {
  try {
    const saved = localStorage.getItem(ROOM_KEY);
    return ROOMS.some((r) => r.id === saved) ? saved! : ALL_ROOMS;
  } catch {
    return ALL_ROOMS;
  }
}

type Phase = { name: 'loading' } | { name: 'login' } | { name: 'ready' } | { name: 'error'; message: string };

export function App() {
  const [phase, setPhase] = useState<Phase>({ name: 'loading' });

  useEffect(() => {
    (async () => {
      try {
        await loadConfig();
        handleRedirect();
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
        <button className="btn btn-primary btn-wide" onClick={() => login()}>W-SSO でログイン</button>
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
  const [roomFilter, setRoomFilter] = useState(loadRoomFilter);
  const [today, setToday] = useState<MyTaskToday | null>(null);
  /** 最後に MyTask! に送った「電池の少ない機器」の組み合わせ (変わったときだけ送る) */
  const reportedBatteries = useRef('');

  const chooseRoom = (id: string) => {
    setRoomFilter(id);
    try {
      localStorage.setItem(ROOM_KEY, id);
    } catch {
      /* 保存できなくても切り替えは動く */
    }
  };

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
      const d = await fetchDevices();
      setData(d);
      await syncMyTask(d.devices);
    } catch (e) {
      handleError(e);
    } finally {
      setRefreshing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleError]);

  /** MyTask! と連携: 電池の少ない機器を送り (組み合わせが変わったときだけ)、今日のタスクを読む。失敗しても機器の表示は止めない */
  const syncMyTask = async (devices: Device[]) => {
    try {
      const low = lowBatteryDevices(devices);
      const key = low.map((d) => d.id).sort().join(',');
      if (key && key !== reportedBatteries.current) {
        const created = await reportBatteries(low);
        if (created.length) showToast(`MyTask! に「${created.join('」「')}」を追加しました`);
      }
      reportedBatteries.current = key;
      setToday(await fetchToday());
    } catch (e) {
      console.warn('MyTask!', e);
    }
  };

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

  const updated = data ? new Date(data.fetchedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : null;
  const visibleRooms = ROOMS.filter((r) => roomFilter === ALL_ROOMS || r.id === roomFilter);

  const roomNav = [{ id: ALL_ROOMS, name: 'すべて' }, ...ROOMS];

  return (
    <div className="shell">
      {/* PC: スクロールしても動かない左メニュー */}
      <aside className="sidebar" aria-label="メインメニュー">
        <div className="brand">
          <img src="/icon.svg" alt="" width={36} height={36} />
          <strong>おうちダッシュボード</strong>
        </div>
        <nav aria-label="部屋の切り替え">
          <ul className="side-nav">
            {roomNav.map((r) => (
              <li key={r.id}>
                <button className={r.id === roomFilter ? 'active' : ''} aria-current={r.id === roomFilter ? 'page' : undefined} onClick={() => chooseRoom(r.id)}>
                  {r.id === ALL_ROOMS ? <NavAll /> : <NavRoom />}
                  <span>{r.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="side-foot">
          <ul className="side-nav">
            <li>
              <button onClick={() => void refresh()} disabled={refreshing}>
                <NavRefresh />
                <span>{refreshing ? '更新中…' : '機器情報を更新'}</span>
              </button>
              {updated && <p className="side-note">{updated} 更新</p>}
            </li>
            <li>
              <a href="https://apps.wakalabo.net" target="_blank" rel="noreferrer">
                <NavApps />
                <span>アプリ一覧</span>
              </a>
            </li>
            <li>
              <button onClick={logout}>
                <NavLogout />
                <span>ログアウト</span>
              </button>
            </li>
          </ul>
        </div>
      </aside>

      <div className="app">
        <header className="topbar">
          <Clock />
          {/* スマホ: 更新とログアウトは上に (PC は左メニュー) */}
          <div className="topbar-side phone-only">
            <div className="topbar-actions">
              <button className="btn btn-small" onClick={() => void refresh()} disabled={refreshing}>
                {refreshing ? '更新中…' : '更新'}
              </button>
              <button className="btn btn-small btn-ghost" onClick={logout}>ログアウト</button>
            </div>
            {updated && <p className="muted small">機器情報 {updated} 更新</p>}
          </div>
        </header>

        <WeatherPanel />

        {today && <TaskPanel today={today} siteUrl={getConfig().mytaskSiteUrl ?? ''} />}

        {data?.errors.map((e) => (
          <p key={e.provider} className="banner">
            {e.provider === 'remo' ? 'Nature Remo' : 'SwitchBot'}: {e.message}
          </p>
        ))}

        {!data && <p className="muted center-text">機器を読み込み中…</p>}

        {data && (
          <div className={`rooms${visibleRooms.length > 1 ? ' rooms-split' : ''}`}>
            {visibleRooms.map((room) => (
              <RoomPanel key={room.id} room={room} devices={data.devices} onCommand={onCommand} />
            ))}
          </div>
        )}
      </div>

      {/* スマホ: 部屋の切り替えは下のタブ */}
      <nav className="tabbar" style={{ gridTemplateColumns: `repeat(${roomNav.length}, minmax(0, 1fr))` }} aria-label="部屋の切り替え">
        {roomNav.map((r) => (
          <button key={r.id} className={r.id === roomFilter ? 'active' : ''} aria-current={r.id === roomFilter ? 'page' : undefined} onClick={() => chooseRoom(r.id)}>
            {r.id === ALL_ROOMS ? <NavAll size={24} /> : <NavRoom size={24} />}
            <span>{r.name}</span>
          </button>
        ))}
      </nav>

      {toast && (
        <div className={`toast${toast.error ? ' toast-error' : ''}`} role="status">
          {toast.text}
        </div>
      )}
    </div>
  );
}
