import {
  CostExplorerClient,
  GetCostAndUsageCommand,
  type ResultByTime,
} from '@aws-sdk/client-cost-explorer';
import { FreeTierClient, GetAccountPlanStateCommand } from '@aws-sdk/client-freetier';
import { GetParameterCommand, PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { cached } from './cache.js';
import type { CostsResponse, ServiceCost } from './types.js';

// Cost Explorer API は 1 回 0.01 USD かかる。
// AWS 側のデータ更新も 1 日に数回なので、結果を 12 時間保存して呼び出しを 1 日 2 回までに抑える
// (最大でも 1 か月 約 0.6 USD)。
export const COST_TTL_MS = 12 * 60 * 60_000;
const MAX_SERVICES = 8;

// Cost Explorer と Free Tier はグローバルサービスで、API の窓口が us-east-1 にある。
// リソースは作らず読み取るだけなので、プロジェクトのリージョン制約には当たらない。
const ce = new CostExplorerClient({ region: 'us-east-1' });
const freeTier = new FreeTierClient({ region: 'us-east-1' });
const ssm = new SSMClient({});

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** 先月 1 日〜今日 (今日は含まない、UTC) の期間 */
export function costPeriod(now: Date): { start: string; thisMonth: string; end: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return {
    start: ymd(new Date(Date.UTC(y, m - 1, 1))),
    thisMonth: ymd(new Date(Date.UTC(y, m, 1))),
    end: ymd(new Date(Date.UTC(y, m, now.getUTCDate()))),
  };
}

/** Cost Explorer から取れる部分 (すべて必須) */
export type Usage = Required<Pick<CostsResponse, 'currency' | 'thisMonth' | 'lastMonth'>>;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Cost Explorer の月別・サービス別の結果を画面用に変換する */
export function summarize(
  results: ResultByTime[],
  period: { start: string; thisMonth: string },
): Usage {
  let currency = 'USD';
  const services = (start: string): ServiceCost[] => {
    const month = results.find((r) => r.TimePeriod?.Start === start);
    return (month?.Groups ?? [])
      .map((g) => {
        const metric = g.Metrics?.UnblendedCost;
        if (metric?.Unit) currency = metric.Unit;
        return { name: g.Keys?.[0] ?? '不明', amount: Number(metric?.Amount ?? 0) };
      })
      .filter((s) => Math.abs(s.amount) >= 0.005)
      .sort((a, b) => b.amount - a.amount);
  };
  const total = (list: ServiceCost[]) => round2(list.reduce((sum, s) => sum + s.amount, 0));

  const current = services(period.thisMonth);
  const last = services(period.start);
  const top = current.slice(0, MAX_SERVICES).map((s) => ({ ...s, amount: round2(s.amount) }));
  const rest = current.slice(MAX_SERVICES);
  if (rest.length > 0) top.push({ name: 'その他', amount: total(rest) });

  return {
    currency,
    thisMonth: { start: period.thisMonth, total: total(current), services: top },
    lastMonth: { start: period.start, total: total(last) },
  };
}

function explain(e: unknown): Error {
  const name = e instanceof Error ? e.name : '';
  if (name === 'DataUnavailableException') {
    return new Error('Cost Explorer がまだ有効になっていません。請求コンソールで Cost Explorer を一度開くと、約 24 時間後から表示できます');
  }
  if (name === 'AccessDeniedException') {
    return new Error('利用料を読み取る権限がありません。プランで Cost Explorer が使えるか確認してください');
  }
  return e instanceof Error ? e : new Error(String(e));
}

async function fetchUsage(): Promise<Usage> {
  const period = costPeriod(new Date());
  const results: ResultByTime[] = [];
  let token: string | undefined;
  do {
    const res = await ce.send(
      new GetCostAndUsageCommand({
        TimePeriod: { Start: period.start, End: period.end },
        Granularity: 'MONTHLY',
        Metrics: ['UnblendedCost'],
        GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
        // 無料プランのクレジットで相殺される前の「実際に使った額」を見たいので除外する
        Filter: { Not: { Dimensions: { Key: 'RECORD_TYPE', Values: ['Credit', 'Refund'] } } },
        NextPageToken: token,
      }),
    );
    results.push(...(res.ResultsByTime ?? []));
    token = res.NextPageToken;
  } while (token);
  return summarize(results, period);
}

async function fetchPlan(): Promise<NonNullable<CostsResponse['plan']>> {
  const p = await freeTier.send(new GetAccountPlanStateCommand({}));
  return {
    type: p.accountPlanType ?? 'UNKNOWN',
    status: p.accountPlanStatus,
    remainingCredits: p.accountPlanRemainingCredits?.amount,
    creditUnit: p.accountPlanRemainingCredits?.unit,
    expiresAt: p.accountPlanExpirationDate?.toISOString(),
  };
}

// 利用額 (Cost Explorer) とプラン情報 (Free Tier API) は片方だけでも表示する。
// 無料プランで Cost Explorer が使えなくても、クレジット残高と期限は見られるようにするため
export async function fetchCosts(
  usage: () => Promise<Usage> = fetchUsage,
  planState: () => Promise<NonNullable<CostsResponse['plan']>> = fetchPlan,
): Promise<CostsResponse> {
  const [u, p] = await Promise.allSettled([usage(), planState()]);
  if (u.status === 'rejected') console.warn('GetCostAndUsage failed', u.reason);
  if (p.status === 'rejected') console.warn('GetAccountPlanState failed', p.reason);
  if (u.status === 'rejected' && p.status === 'rejected') throw explain(u.reason);
  return {
    ...(u.status === 'fulfilled' ? u.value : { costsError: explain(u.reason).message }),
    plan: p.status === 'fulfilled' ? p.value : undefined,
    fetchedAt: new Date().toISOString(),
  };
}

// 利用額が取れなかったとき (Cost Explorer の有効化待ちなど) は 1 時間で取り直す
export const isFresh = (c: CostsResponse | undefined, now = Date.now()): c is CostsResponse =>
  !!c?.fetchedAt && now - new Date(c.fetchedAt).getTime() < (c.costsError ? 60 * 60_000 : COST_TTL_MS);

// Lambda はしばらく使わないとメモリが消えるので、結果を SSM パラメータ (標準・無料) にも保存する
async function loadSaved(name: string): Promise<CostsResponse | undefined> {
  try {
    const res = await ssm.send(new GetParameterCommand({ Name: name }));
    return JSON.parse(res.Parameter?.Value ?? '{}') as CostsResponse;
  } catch (e) {
    console.warn('cost cache read failed', e);
    return undefined;
  }
}

async function getCostsUncached(cacheParam: string): Promise<CostsResponse> {
  const saved = await loadSaved(cacheParam);
  if (isFresh(saved)) return saved;
  const fresh = await fetchCosts();
  await ssm
    .send(new PutParameterCommand({ Name: cacheParam, Value: JSON.stringify(fresh), Type: 'String', Overwrite: true }))
    .catch((e) => console.warn('cost cache write failed', e));
  return fresh;
}

// メモリ上は 1 時間だけ持ち、期限切れの判定は保存した取得時刻 (12 時間) で行う
export function getCosts(cacheParam: string): Promise<CostsResponse> {
  return cached('costs', 60 * 60_000, () => getCostsUncached(cacheParam));
}
