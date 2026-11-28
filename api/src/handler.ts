import { randomUUID } from 'node:crypto';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { clients, errorMessage, runActions, runCommand, validateCommand } from './clients.js';
import { MAX_SCHEDULES, validateSchedule } from './schedule.js';
import { createSchedule, deleteSchedule, listSchedules, updateSchedule } from './schedule-store.js';
import type { Device, DevicesResponse, ProviderError, Schedule, ScheduleRunResult } from './types.js';

const json = (statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

async function listDevices(): Promise<DevicesResponse> {
  const c = await clients();
  const devices: Device[] = [];
  const errors: ProviderError[] = [];
  const tasks: Promise<void>[] = [];
  if (c.switchbot) {
    tasks.push(
      c.switchbot.listDevices().then(
        (d) => void devices.push(...d),
        (e) => void errors.push({ provider: 'switchbot', message: errorMessage(e) }),
      ),
    );
  }
  if (c.remo) {
    tasks.push(
      c.remo.listDevices().then(
        (d) => void devices.push(...d),
        (e) => void errors.push({ provider: 'remo', message: errorMessage(e) }),
      ),
    );
  }
  await Promise.all(tasks);
  if (!c.switchbot && !c.remo) {
    errors.push({ provider: 'switchbot', message: 'API トークンが登録されていません (README 参照)' });
  }
  devices.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  return { devices, errors, fetchedAt: new Date().toISOString() };
}

async function sendCommand(rawId: string, body: string | undefined): Promise<void> {
  await runCommand(decodeURIComponent(rawId), validateCommand(JSON.parse(body ?? '{}')));
}

// ---------- スケジュール ----------

/** 画面に返す形 (内部用の lastRunKey は返さない) */
async function getSchedules(): Promise<Schedule[]> {
  return (await listSchedules()).map(({ lastRunKey: _, ...s }) => s);
}

async function addSchedule(body: string | undefined): Promise<{ id: string }> {
  const input = validateSchedule(JSON.parse(body ?? '{}'));
  if ((await listSchedules()).length >= MAX_SCHEDULES) {
    throw new Error(`スケジュールは ${MAX_SCHEDULES} 件までです`);
  }
  const id = randomUUID();
  await createSchedule(id, input);
  return { id };
}

async function editSchedule(id: string, body: string | undefined): Promise<void> {
  const input = validateSchedule(JSON.parse(body ?? '{}'));
  if (!(await updateSchedule(id, input))) throw new Error('スケジュールが見つかりません');
}

/** 「今すぐ実行」。試しに動かすためのもので、実行の記録 (lastRun) は変えない */
async function runScheduleNow(id: string): Promise<ScheduleRunResult> {
  const s = (await listSchedules()).find((x) => x.id === id);
  if (!s) throw new Error('スケジュールが見つかりません');
  const results = await runActions(s.actions);
  return { at: new Date().toISOString(), ok: results.every((r) => r.ok), results };
}

/** JWT の cognito:groups は ["a","b"] / "[a b]" / "[a, b]" などの形で届く */
export function groupsFromClaim(claim: unknown): string[] {
  if (Array.isArray(claim)) return claim.map(String);
  if (typeof claim !== 'string') return [];
  return claim
    .replace(/^\[|\]$/g, '')
    .split(/[\s,]+/)
    .map((s) => s.replace(/^"|"$/g, ''))
    .filter(Boolean);
}

const APP_GROUP = 'app-smart-home';

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  // W-SSO のアカウントのうち、使えるのは admin か app-smart-home グループの人だけ
  const groups = groupsFromClaim(event.requestContext.authorizer?.jwt?.claims?.['cognito:groups']);
  if (!groups.includes('admin') && !groups.includes(APP_GROUP)) {
    return json(403, { message: 'おうちダッシュボードを使う権限がありません。ダッシュボード (apps.wakalabo.net) の管理者に追加してもらってください' });
  }
  try {
    switch (event.routeKey) {
      case 'GET /devices':
        return json(200, await listDevices());
      case 'POST /devices/{id}/command':
        await sendCommand(event.pathParameters?.id ?? '', event.body);
        return json(200, { ok: true });
      case 'GET /schedules':
        return json(200, { schedules: await getSchedules() });
      case 'POST /schedules':
        return json(200, await addSchedule(event.body));
      case 'PUT /schedules/{id}':
        await editSchedule(event.pathParameters?.id ?? '', event.body);
        return json(200, { ok: true });
      case 'DELETE /schedules/{id}':
        await deleteSchedule(event.pathParameters?.id ?? '');
        return json(200, { ok: true });
      case 'POST /schedules/{id}/run':
        return json(200, await runScheduleNow(event.pathParameters?.id ?? ''));
      default:
        return json(404, { message: 'Not Found' });
    }
  } catch (e) {
    console.error(e);
    return json(400, { message: errorMessage(e) });
  }
}
