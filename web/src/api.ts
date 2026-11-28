import type { Command, DevicesResponse, Schedule, ScheduleInput, ScheduleRunResult } from '../../api/src/types';
import { getAccessToken } from './auth';
import { getConfig } from './config';

export class AuthError extends Error {}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new AuthError('ログインが必要です');
  const res = await fetch(`${getConfig().apiUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (res.status === 401) throw new AuthError('ログインの有効期限が切れました');
  const body = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(body.message ?? `エラーが発生しました (${res.status})`);
  return body;
}

export const fetchDevices = () => call<DevicesResponse>('/devices');

export const sendCommand = (deviceId: string, command: Command) =>
  call<{ ok: true }>(`/devices/${encodeURIComponent(deviceId)}/command`, {
    method: 'POST',
    body: JSON.stringify(command),
  });


// ---------- スケジュール ----------

export const fetchSchedules = () => call<{ schedules: Schedule[] }>('/schedules').then((r) => r.schedules);

export const createSchedule = (input: ScheduleInput) =>
  call<{ id: string }>('/schedules', { method: 'POST', body: JSON.stringify(input) });

export const updateSchedule = (id: string, input: ScheduleInput) =>
  call<{ ok: true }>(`/schedules/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) });

export const deleteSchedule = (id: string) =>
  call<{ ok: true }>(`/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const runSchedule = (id: string) =>
  call<ScheduleRunResult>(`/schedules/${encodeURIComponent(id)}/run`, { method: 'POST' });
