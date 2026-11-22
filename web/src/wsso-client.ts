/**
 * W-SSO (wakalabo 共通ログイン) をアプリから使うための小さなライブラリ。
 * kakeibo・waripo などの各アプリは、このファイルをそのままコピーして使う (元は wakalabo-apps/web/src/wsso-client.ts)。
 *
 * 流れ:
 *   1. login() で W-SSO のログイン画面 (https://apps.wakalabo.net/sso.html) へ移動する
 *   2. ログインすると、W-SSO が URL の # 部分 (#wsso=...) にトークンを付けてアプリに戻す
 *      (# 以降はサーバーに送られない)。handleRedirect() がそれを受け取って保存し、URL から消す
 *   3. アクセストークンの期限 (1 時間) が切れたら、リフレッシュトークンで Cognito から取り直す
 *   4. logout() は W-SSO のログアウトへ移動する (すべてのアプリからログアウトされる)
 */

export interface WssoConfig {
  /** W-SSO のある URL (例 https://apps.wakalabo.net) */
  ssoUrl: string;
  /** W-SSO のアプリ クライアント ID (全アプリ共通) */
  userPoolClientId: string;
  region: string;
  /** shared/apps.ts の id。権限の確認とログイン画面の表示に使う (ダッシュボード自身は "portal") */
  appId: string;
  /** このアプリの localStorage のキー */
  storageKey: string;
}

interface Session {
  accessToken: string;
  refreshToken: string;
  /** ミリ秒 */
  expiresAt: number;
}

/** W-SSO がアプリに渡す内容 (#wsso= の中身) */
export interface Handoff {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

let cfg: WssoConfig | undefined;

export function configure(c: WssoConfig): void {
  cfg = c;
}

function conf(): WssoConfig {
  if (!cfg) throw new Error('W-SSO の設定が読み込まれていません');
  return cfg;
}

const b64urlDecode = (s: string) => {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  return decodeURIComponent(
    Array.from(atob(t + '='.repeat((4 - (t.length % 4)) % 4)))
      .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
      .join(''),
  );
};

export const b64urlEncode = (s: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

function load(): Session | null {
  try {
    const raw = localStorage.getItem(conf().storageKey);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function save(s: Session | null): void {
  try {
    if (s) localStorage.setItem(conf().storageKey, JSON.stringify(s));
    else localStorage.removeItem(conf().storageKey);
  } catch {
    /* 保存できなくても、この画面の間は使える */
  }
}

/** W-SSO から戻ってきたときの #wsso=... を受け取る */
export function handleRedirect(): void {
  const m = location.hash.match(/[#&]wsso=([^&]+)/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  const h = JSON.parse(b64urlDecode(m[1]!)) as Handoff;
  save({ accessToken: h.accessToken, refreshToken: h.refreshToken, expiresAt: Date.now() + h.expiresIn * 1000 });
}

export const isLoggedIn = () => load() !== null;

/** Cognito の API を直接呼ぶ (クライアント シークレットなしの公開クライアントなので署名は不要) */
export async function cognito<T>(region: string, target: string, body: unknown): Promise<T> {
  const res = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { __type?: string; message?: string };
  if (!res.ok) {
    const err = new Error(json.message ?? `Cognito のエラー (${res.status})`);
    err.name = (json.__type ?? 'Error').split('#').pop()!;
    throw err;
  }
  return json;
}

/** 有効なアクセストークン。期限が近ければ取り直す。ログインし直しが必要なら null */
export async function getAccessToken(): Promise<string | null> {
  const s = load();
  if (!s) return null;
  if (s.expiresAt - 60_000 > Date.now()) return s.accessToken;
  const { region, userPoolClientId } = conf();
  try {
    const r = await cognito<{ AuthenticationResult: { AccessToken: string; ExpiresIn: number } }>(region, 'InitiateAuth', {
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: userPoolClientId,
      AuthParameters: { REFRESH_TOKEN: s.refreshToken },
    });
    const next = { ...s, accessToken: r.AuthenticationResult.AccessToken, expiresAt: Date.now() + r.AuthenticationResult.ExpiresIn * 1000 };
    save(next);
    return next.accessToken;
  } catch {
    save(null);
    return null;
  }
}

function claims(): Record<string, unknown> {
  const t = load()?.accessToken;
  if (!t) return {};
  try {
    return JSON.parse(b64urlDecode(t.split('.')[1]!)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** ログイン中のユーザーの ID (Cognito の sub)。各アプリのデータはこれで分ける */
export const currentUserId = () => (claims().sub as string | undefined) ?? undefined;
export const currentGroups = () => {
  const g = claims()['cognito:groups'];
  return Array.isArray(g) ? g.map(String) : [];
};
export const isAdmin = () => currentGroups().includes('admin');

const returnUrl = () => `${location.origin}/`;

export function login(): void {
  const { ssoUrl, appId } = conf();
  location.assign(`${ssoUrl}/sso.html?app=${encodeURIComponent(appId)}&return=${encodeURIComponent(returnUrl())}`);
}

/** すべての wakalabo アプリからログアウトする */
export function logout(): void {
  const { ssoUrl, appId } = conf();
  save(null);
  location.assign(`${ssoUrl}/sso.html?logout=1&app=${encodeURIComponent(appId)}&return=${encodeURIComponent(returnUrl())}`);
}
