// ログインは W-SSO (wakalabo 共通ログイン) を使う。wsso-client.ts は wakalabo-apps のものをコピーしている
export { getAccessToken, handleRedirect, isLoggedIn, login, logout } from './wsso-client';
