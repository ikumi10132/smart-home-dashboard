import type { MyTaskToday } from '../mytask';

/** MyTask! の今日のタスク。何もなければ「なし」と出す */
export function TaskPanel({ today, siteUrl }: { today: MyTaskToday; siteUrl: string }) {
  const empty = !today.due.length && !today.remind.length && !today.over.length && !today.stale;
  return (
    <section className="panel tasks" aria-label="今日のタスク">
      <header className="tasks-head">
        <h2>今日のタスク</h2>
        {siteUrl && (
          <a className="btn btn-small" href={siteUrl} target="_blank" rel="noreferrer">MyTask! を開く</a>
        )}
      </header>
      {empty ? (
        <p className="muted small">今日やることはありません</p>
      ) : (
        <ul className="tasks-list">
          {today.due.map((t) => (
            <li key={t.id}><span className="task-tag task-tag-due">期限</span>{t.title}</li>
          ))}
          {today.remind.map((t) => (
            <li key={t.id}><span className="task-tag">今日</span>{t.title}</li>
          ))}
          {today.over.map((t) => (
            <li key={t.id}>
              <span className="task-tag task-tag-over">家事</span>
              {t.title}
              <span className="muted small"> {t.daysSince === null ? 'まだ' : `${t.daysSince}/${t.intervalDays}日`}</span>
            </li>
          ))}
          {today.stale > 0 && <li className="muted small">しばらく手を付けていないタスクが {today.stale} 件</li>}
        </ul>
      )}
    </section>
  );
}
