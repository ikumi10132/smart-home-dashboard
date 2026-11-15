// API と Web で共有する型定義

export type Provider = 'switchbot' | 'remo';

export type Kind =
  | 'aircon'
  | 'light'
  | 'switch'
  | 'curtain'
  | 'bot'
  | 'tv'
  | 'ir'
  | 'sensor';

export type AirconMode = 'auto' | 'cool' | 'heat' | 'dry' | 'fan';

export interface DeviceState {
  power?: 'on' | 'off';
  temperature?: number;
  humidity?: number;
  brightness?: number;
  /** カーテンの開閉位置 (0 = 全開, 100 = 全閉) */
  position?: number;
  battery?: number;
  mode?: AirconMode;
  targetTemperature?: number;
}

export interface DeviceButton {
  name: string;
  label: string;
}

export interface Device {
  /** "switchbot:<id>" / "remo:<id>" の形式 */
  id: string;
  provider: Provider;
  name: string;
  kind: Kind;
  model?: string;
  /** 赤外線リモコン経由の家電 (状態が取得できない場合がある) */
  infrared: boolean;
  state: DeviceState;
  aircon?: {
    modes: AirconMode[];
    /** モードごとに設定可能な温度。空配列なら温度指定なし */
    temperatures: Partial<Record<AirconMode, number[]>>;
  };
  buttons?: DeviceButton[];
}

export type Command =
  | { action: 'on' }
  | { action: 'off' }
  | { action: 'open' }
  | { action: 'close' }
  | { action: 'press' }
  | { action: 'aircon'; power: 'on' | 'off'; mode?: AirconMode; temperature?: number }
  | { action: 'button'; button: string };

export interface ProviderError {
  provider: Provider;
  message: string;
}

export interface DevicesResponse {
  devices: Device[];
  errors: ProviderError[];
  fetchedAt: string;
}
