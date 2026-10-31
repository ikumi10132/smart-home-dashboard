export interface AppConfig {
  apiUrl: string;
  userPoolClientId: string;
  cognitoDomain: string;
}

let config: AppConfig | undefined;

/** デプロイ時に CDK が書き出す /config.json を読み込む */
export async function loadConfig(): Promise<AppConfig> {
  const res = await fetch('/config.json', { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('config.json が見つかりません。ローカル開発時は web/public/config.json を作成してください');
  }
  config = (await res.json()) as AppConfig;
  return config;
}

export function getConfig(): AppConfig {
  if (!config) throw new Error('config が読み込まれていません');
  return config;
}
