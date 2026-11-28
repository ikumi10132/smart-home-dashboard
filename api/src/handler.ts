import { randomUUID } from 'node:crypto';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { clients, errorMessage, runActions, runCommand, validateCommand } from './clients.js';
import { MAX_AUTOMATIONS, validateAutomation } from './automation.js';
import { createAutomation, deleteAutomation, listAutomations, updateAutomation } from './automation-store.js';
import type { Automation, Device, DevicesResponse, ProviderError, ScheduleRunResult } from './types.js';

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

// ---------- オートメーション ----------

/** 画面に返す形 (判定用の内部の値は返さない) */
async function getAutomations(): Promise<Automation[]> {
  return (await listAutomations()).map(({ lastRunKey: _k, triggerMet: _m, ...a }) => a);
}

async function addAutomation(body: string | undefined): Promise<{ id: string }> {
  const input = validateAutomation(JSON.parse(body ?? '{}'));
  if ((await listAutomations()).length >= MAX_AUTOMATIONS) {
    throw new Error(`オートメーションは ${MAX_AUTOMATIONS} 件までです`);
  }
  const id = randomUUID();
  await createAutomation(id, input);
  return { id };
}

async function editAutomation(id: string, body: string | undefined): Promise<void> {
  const input = validateAutomation(JSON.parse(body ?? '{}'));
  if (!(await updateAutomation(id, input))) throw new Error('オートメーションが見つかりません');
}

/** 「今すぐ実行」。きっかけと条件は見ずに操作だけ試す。前回の結果 (lastRun) は変えない */
async function runAutomationNow(id: string): Promise<ScheduleRunResult> {
  const a = (await listAutomations()).find((x) => x.id === id);
  if (!a) throw new Error('オートメーションが見つかりません');
  const results = await runActions(a.actions);
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
      case 'GET /automations':
        return json(200, { automations: await getAutomations() });
      case 'POST /automations':
        return json(200, await addAutomation(event.body));
      case 'PUT /automations/{id}':
        await editAutomation(event.pathParameters?.id ?? '', event.body);
        return json(200, { ok: true });
      case 'DELETE /automations/{id}':
        await deleteAutomation(event.pathParameters?.id ?? '');
        return json(200, { ok: true });
      case 'POST /automations/{id}/run':
        return json(200, await runAutomationNow(event.pathParameters?.id ?? ''));
      default:
        return json(404, { message: 'Not Found' });
    }
  } catch (e) {
    console.error(e);
    return json(400, { message: errorMessage(e) });
  }
}
