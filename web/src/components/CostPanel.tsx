import { useEffect, useState } from 'react';
import type { CostsResponse } from '../../../api/src/types';
import { AuthError, fetchCosts } from '../api';

const money = (n: number, currency: string) =>
  new Intl.NumberFormat('ja-JP', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const monthLabel = (ymd: string) => `${Number(ymd.slice(5, 7))}月`;

/** 今月の日割りから月末の目安を出す (Cost Explorer の予測 API は有料なので使わない) */
export function estimateMonthEnd(total: number, thisMonthStart: string, fetchedAt: string): number | null {
  const start = new Date(`${thisMonthStart}T00:00:00Z`);
  const days = Math.floor((new Date(fetchedAt).getTime() - start.getTime()) / 86_400_000); // 昨日までの日数
  if (days < 1) return null;
  const daysInMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  return (total / days) * daysInMonth;
}

export function CostPanel({ onAuthError }: { onAuthError: () => void }) {
  const [costs, setCosts] = useState<CostsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 自動更新はしない (AWS 側の更新も 1 日数回のため)
  useEffect(() => {
    fetchCosts().then(setCosts, (e: unknown) => {
      if (e instanceof AuthError) return onAuthError();
      setError(e instanceof Error ? e.message : String(e));
    });
  }, [onAuthError]);

  const fmt = (n: number) => money(n, costs?.currency ?? 'USD');
  const estimate = costs && estimateMonthEnd(costs.thisMonth.total, costs.thisMonth.start, costs.fetchedAt);
  const plan = costs?.plan;

  return (
    <details className="panel costs">
      <summary>
        <span className="costs-title">AWS の利用料</span>
        <span className="costs-summary">
          {costs ? `${monthLabel(costs.thisMonth.start)} ${fmt(costs.thisMonth.total)}` : error ? '取得できませんでした' : '読み込み中…'}
        </span>
      </summary>

      {error && <p className="error-text small costs-body">{error}</p>}

      {costs && (
        <div className="costs-body">
          <dl className="costs-facts">
            <div><dt>今月 (昨日まで)</dt><dd>{fmt(costs.thisMonth.total)}</dd></div>
            {estimate !== null && <div><dt>月末の目安</dt><dd>{fmt(estimate)}</dd></div>}
            <div><dt>先月 ({monthLabel(costs.lastMonth.start)})</dt><dd>{fmt(costs.lastMonth.total)}</dd></div>
            {plan?.type === 'FREE' && plan.remainingCredits !== undefined && (
              <div>
                <dt>無料クレジット残り</dt>
                <dd>{money(plan.remainingCredits, plan.creditUnit ?? 'USD')}</dd>
              </div>
            )}
          </dl>

          {costs.thisMonth.services.length > 0 ? (
            <ul className="costs-services" aria-label="今月のサービス別">
              {costs.thisMonth.services.map((s) => (
                <li key={s.name}><span>{s.name}</span><span>{fmt(s.amount)}</span></li>
              ))}
            </ul>
          ) : (
            <p className="muted small">今月の利用はまだありません</p>
          )}

          <p className="muted small">
            クレジット適用前の金額です。
            {plan?.type === 'FREE' && plan.expiresAt && `無料プランの期限: ${new Date(plan.expiresAt).toLocaleDateString('ja-JP')}。`}
            {new Date(costs.fetchedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 取得 (12 時間ごと)
          </p>
        </div>
      )}
    </details>
  );
}
