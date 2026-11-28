// wakalabo 共通のログ送信。どの画面を開いたか・画面で起きたエラー・表示にかかった時間を、
// ダッシュボード (apps.wakalabo.net) の POST /events に送る。管理者が「ログ」の画面で見る。
// 各アプリはこのファイルを wakalabo-apps からコピーして使う (wsso-client.ts と同じ)。
//
// 送らないもの: 入力した内容 (金額・店名・メモ・タスク名など)。画面の名前とエラーの文だけを送る。
// 送れなくても画面の動きには影響しない (失敗は無視する)。

type Kind = 'view' | 'error' | 'perf';
interface LogEvent {
  kind: Kind;
  screen?: string;
  message?: string;
  ms?: number;
  at: number;
}

interface LogConfig {
  /** POST /events の URL (config.json の logUrl)。空なら何も送らない */
  url?: string;
  /** shared/apps.ts のアプリ id (ダッシュボード自身は wakalabo-apps) */
  app: string;
  /** W-SSO のアクセストークン (ログインしていなければ null) */
  getToken: () => Promise<string | null>;
}

const MAX_BATCH = 20;
const MAX_QUEUE = 100;
const FLUSH_MS = 10_000;

let conf: LogConfig | undefined;
const queue: LogEvent[] = [];
let current = '';
let lastErrors: string[] = [];

function push(e: Omit<LogEvent, 'at'>) {
  if (!conf?.url) return;
  queue.push({ ...e, at: Date.now() });
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
}

/** たまったログを送る。送れなかったら捨てる (同じエラーが繰り返し届かないように) */
async function flush(): Promise<void> {
  if (!conf?.url || !queue.length) return;
  let token: string | null = null;
  try {
    token = await conf.getToken();
  } catch {
    /* ログインしていない */
  }
  if (!token) return; // ログインするまでためておく
  const events = queue.splice(0, MAX_BATCH);
  try {
    await fetch(conf.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ app: conf.app, events }),
      keepalive: true,
    });
  } catch {
    /* 送れなくても画面には影響させない */
  }
  if (queue.length) void flush();
}

/** 画面で起きたエラーを記録する (同じエラーは 1 分に 1 回まで) */
export function logError(error: unknown) {
  const message = (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 300);
  if (lastErrors.includes(message)) return;
  lastErrors.push(message);
  window.setTimeout(() => (lastErrors = lastErrors.filter((m) => m !== message)), 60_000);
  push({ kind: 'error', screen: current || undefined, message });
}

/** 画面 (タブ) を開いたことを記録する。同じ画面が続くときは 1 回だけ */
export function logView(screen: string) {
  if (screen === current) return;
  current = screen;
  push({ kind: 'view', screen });
}

/** 最初に 1 回呼ぶ。エラーの記録・表示にかかった時間の記録・定期的な送信を始める */
export function initLog(c: LogConfig) {
  if (conf) return;
  conf = c;
  if (!c.url) return;
  window.addEventListener('error', (e) => logError(e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => logError(e.reason));
  // ページを開いてから表示が終わるまでの時間 (古い Safari にもある Navigation Timing を使う)
  const recordLoad = () => {
    const t = performance.timing;
    if (t && t.loadEventEnd > 0) push({ kind: 'perf', screen: current || undefined, ms: t.loadEventEnd - t.navigationStart });
  };
  if (document.readyState === 'complete') window.setTimeout(recordLoad, 0);
  else window.addEventListener('load', () => window.setTimeout(recordLoad, 0));
  window.setInterval(() => void flush(), FLUSH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush();
  });
}
