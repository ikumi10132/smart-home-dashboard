// MyTask! (タスク管理アプリ) との連携。同じ W-SSO のログインのまま、ブラウザから MyTask! の API を直接呼ぶ
// (おうちダッシュボードの AWS 側には何も足さない)。
// - 今日のタスクを表示する
// - 電池残量が少ない機器を送り、MyTask! に「〇〇の電池交換」のタスクを作ってもらう (同じ機器は二重に作られない)
import type { Device } from '../../api/src/types';
import { getAccessToken } from './auth';
import { getConfig } from './config';

/** MyTask! の api/src/types.ts の TodayData と同じ形 (必要な項目だけ) */
export interface MyTaskToday {
  message: string;
  due: { id: string; title: string; due: string }[];
  remind: { id: string; title: string }[];
  over: { id: string; title: string; daysSince: number | null; intervalDays: number }[];
  stale: number;
}

/** MyTask! と同じしきい値。これ以下の機器だけを送る */
export const BATTERY_THRESHOLD = 20;

/** MyTask! を使えない (未デプロイ・グループに入っていない) ときは null */
async function call<T>(path: string, init?: RequestInit): Promise<T | null> {
  const base = getConfig().mytaskApiUrl;
  if (!base) return null;
  const token = await getAccessToken();
  if (!token) return null;
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(`MyTask! の読み込みに失敗しました (${res.status})`);
  return (await res.json()) as T;
}

export const fetchToday = () => call<MyTaskToday>('/today');

export function lowBatteryDevices(devices: Device[]): { id: string; name: string; battery: number }[] {
  return devices
    .filter((d) => d.state.battery !== undefined && d.state.battery <= BATTERY_THRESHOLD)
    .map((d) => ({ id: d.id, name: d.name, battery: d.state.battery! }));
}

/** 電池の少ない機器を MyTask! に送る。作られたタスクの名前を返す */
export async function reportBatteries(devices: { id: string; name: string; battery: number }[]): Promise<string[]> {
  const r = await call<{ created: { title: string }[] }>('/auto/battery', { method: 'POST', body: JSON.stringify({ devices }) });
  return r?.created.map((t) => t.title) ?? [];
}
