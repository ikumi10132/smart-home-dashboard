import { GetParametersCommand, SSMClient } from '@aws-sdk/client-ssm';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { RemoClient } from './remo.js';
import { SwitchBotClient } from './switchbot.js';
import type { Command, Device, DevicesResponse, ProviderError } from './types.js';

const PREFIX = process.env.PARAM_PREFIX ?? '/smart-home-dashboard';
const ssm = new SSMClient({});

interface Clients {
  switchbot?: SwitchBotClient;
  remo?: RemoClient;
}

let clientsPromise: Promise<Clients> | undefined;

// SSM Parameter Store (SecureString) から API トークンを読み込む。
// 登録されていないサービスは無効として扱うので、片方だけでも動く。
async function loadClients(): Promise<Clients> {
  const names = {
    sbToken: `${PREFIX}/switchbot/token`,
    sbSecret: `${PREFIX}/switchbot/secret`,
    remoToken: `${PREFIX}/remo/token`,
  };
  const res = await ssm.send(
    new GetParametersCommand({ Names: Object.values(names), WithDecryption: true }),
  );
  const value = (name: string) => res.Parameters?.find((p) => p.Name === name)?.Value;
  const sbToken = value(names.sbToken);
  const sbSecret = value(names.sbSecret);
  const remoToken = value(names.remoToken);
  return {
    switchbot: sbToken && sbSecret ? new SwitchBotClient(sbToken, sbSecret) : undefined,
    remo: remoToken ? new RemoClient(remoToken) : undefined,
  };
}

function clients(): Promise<Clients> {
  clientsPromise ??= loadClients().catch((e) => {
    clientsPromise = undefined;
    throw e;
  });
  return clientsPromise;
}

const json = (statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

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

const ACTIONS = new Set(['on', 'off', 'open', 'close', 'press', 'aircon', 'button']);

function parseCommand(body: string | undefined): Command {
  const cmd = JSON.parse(body ?? '{}') as Record<string, unknown>;
  if (typeof cmd.action !== 'string' || !ACTIONS.has(cmd.action)) {
    throw new Error('action が不正です');
  }
  if (cmd.action === 'aircon' && cmd.power !== 'on' && cmd.power !== 'off') {
    throw new Error('power が不正です');
  }
  if (cmd.action === 'button' && typeof cmd.button !== 'string') {
    throw new Error('button が不正です');
  }
  return cmd as unknown as Command;
}

async function sendCommand(rawId: string, body: string | undefined): Promise<void> {
  const id = decodeURIComponent(rawId);
  const sep = id.indexOf(':');
  const provider = id.slice(0, sep);
  const deviceId = id.slice(sep + 1);
  const command = parseCommand(body);
  const c = await clients();
  if (provider === 'switchbot' && c.switchbot) return c.switchbot.send(deviceId, command);
  if (provider === 'remo' && c.remo) return c.remo.send(deviceId, command);
  throw new Error(`不明なデバイスです: ${id}`);
}

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    switch (event.routeKey) {
      case 'GET /devices':
        return json(200, await listDevices());
      case 'POST /devices/{id}/command':
        await sendCommand(event.pathParameters?.id ?? '', event.body);
        return json(200, { ok: true });
      default:
        return json(404, { message: 'Not Found' });
    }
  } catch (e) {
    console.error(e);
    return json(400, { message: errorMessage(e) });
  }
}
