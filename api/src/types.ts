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

// ---------- オートメーション ----------

/** 曜日 (0 = 日曜 … 6 = 土曜) */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface ScheduleAction {
  deviceId: string;
  /** 登録したときの機器名 (機器が消えても一覧で分かるように残す) */
  deviceName: string;
  command: Command;
}

/** 機器の状態についての条件 (きっかけにも、条件にも使える) */
export type StateCondition =
  | {
      type: 'sensor';
      deviceId: string;
      deviceName: string;
      metric: 'temperature' | 'humidity';
      /** above = 以上, below = 以下 */
      op: 'above' | 'below';
      value: number;
    }
  | { type: 'power'; deviceId: string; deviceName: string; power: 'on' | 'off' };

export type Condition =
  | StateCondition
  /** 日本時間の時間帯。from > to なら日付をまたぐ (例 22:00〜06:00) */
  | { type: 'timeRange'; from: string; to: string }
  | { type: 'days'; days: Weekday[] };

export type Trigger =
  /** 曜日と時刻 (日本時間 "HH:MM"、5 分単位) */
  | { type: 'time'; days: Weekday[]; time: string }
  /** 状態がこうなったとき (満たしていない → 満たした、に変わったとき) */
  | { type: 'state'; condition: StateCondition };

/** 画面から送る内容 */
export interface AutomationInput {
  name: string;
  enabled: boolean;
  trigger: Trigger;
  /** すべて満たすときだけ実行する */
  conditions: Condition[];
  actions: ScheduleAction[];
  /** 状態がきっかけのとき、一度動いたら次に動くまで空ける分数 */
  cooldownMinutes: number;
}

export interface ActionResult {
  deviceName: string;
  ok: boolean;
  message?: string;
}

export interface ScheduleRunResult {
  at: string;
  ok: boolean;
  results: ActionResult[];
}

export interface Automation extends AutomationInput {
  id: string;
  updatedAt: string;
  lastRun?: ScheduleRunResult;
}
