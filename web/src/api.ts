import type { Automation, AutomationInput, Command, DevicesResponse, ScheduleRunResult } from '../../api/src/types';
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


// ---------- オートメーション ----------

export const fetchAutomations = () => call<{ automations: Automation[] }>('/automations').then((r) => r.automations);

export const createAutomation = (input: AutomationInput) =>
  call<{ id: string }>('/automations', { method: 'POST', body: JSON.stringify(input) });

export const updateAutomation = (id: string, input: AutomationInput) =>
  call<{ ok: true }>(`/automations/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) });

export const deleteAutomation = (id: string) =>
  call<{ ok: true }>(`/automations/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const runAutomation = (id: string) =>
  call<ScheduleRunResult>(`/automations/${encodeURIComponent(id)}/run`, { method: 'POST' });
