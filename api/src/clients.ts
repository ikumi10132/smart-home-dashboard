import { GetParametersCommand, SSMClient } from '@aws-sdk/client-ssm';
import { RemoClient } from './remo.js';
import { SwitchBotClient } from './switchbot.js';
import type { ActionResult, Command, ScheduleAction } from './types.js';

const PREFIX = process.env.PARAM_PREFIX ?? '/smart-home-dashboard';
const ssm = new SSMClient({});

export interface Clients {
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

export function clients(): Promise<Clients> {
  clientsPromise ??= loadClients().catch((e) => {
    clientsPromise = undefined;
    throw e;
  });
  return clientsPromise;
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

const ACTIONS = new Set(['on', 'off', 'open', 'close', 'press', 'aircon', 'button']);
const MODES = new Set(['auto', 'cool', 'heat', 'dry', 'fan']);

/** 画面やスケジュールから届いた命令の形を確かめる */
export function validateCommand(value: unknown): Command {
  const cmd = (value ?? {}) as Record<string, unknown>;
  if (typeof cmd !== 'object' || typeof cmd.action !== 'string' || !ACTIONS.has(cmd.action)) {
    throw new Error('action が不正です');
  }
  if (cmd.action === 'aircon') {
    if (cmd.power !== 'on' && cmd.power !== 'off') throw new Error('power が不正です');
    if (cmd.mode !== undefined && (typeof cmd.mode !== 'string' || !MODES.has(cmd.mode))) {
      throw new Error('mode が不正です');
    }
    if (cmd.temperature !== undefined && (typeof cmd.temperature !== 'number' || !Number.isFinite(cmd.temperature))) {
      throw new Error('temperature が不正です');
    }
    return { action: 'aircon', power: cmd.power, mode: cmd.mode as never, temperature: cmd.temperature as number | undefined };
  }
  if (cmd.action === 'button') {
    if (typeof cmd.button !== 'string' || !cmd.button || cmd.button.length > 200) throw new Error('button が不正です');
    return { action: 'button', button: cmd.button };
  }
  return { action: cmd.action } as Command;
}

/** "switchbot:<id>" / "remo:<id>" の機器に命令を送る */
export async function runCommand(id: string, command: Command): Promise<void> {
  const sep = id.indexOf(':');
  const provider = id.slice(0, sep);
  const deviceId = id.slice(sep + 1);
  const c = await clients();
  if (provider === 'switchbot' && c.switchbot) return c.switchbot.send(deviceId, command);
  if (provider === 'remo' && c.remo) return c.remo.send(deviceId, command);
  throw new Error(`不明なデバイスです: ${id}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** スケジュールの操作を順番に送る。1 つ失敗しても残りは続ける */
export async function runActions(
  actions: ScheduleAction[],
  send: (id: string, command: Command) => Promise<void> = runCommand,
  gapMs = 500,
): Promise<ActionResult[]> {
  const results: ActionResult[] = [];
  for (const [i, a] of actions.entries()) {
    if (i > 0 && gapMs > 0) await sleep(gapMs); // 赤外線の信号が重ならないように少し空ける
    try {
      await send(a.deviceId, a.command);
      results.push({ deviceName: a.deviceName, ok: true });
    } catch (e) {
      results.push({ deviceName: a.deviceName, ok: false, message: errorMessage(e) });
    }
  }
  return results;
}
