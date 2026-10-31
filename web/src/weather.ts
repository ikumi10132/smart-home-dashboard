// 天気は Open-Meteo (https://open-meteo.com/) をブラウザから直接呼ぶ。API キーは不要。

export interface WeatherLocation {
  name: string;
  latitude: number;
  longitude: number;
}

export type Sky = 'clear' | 'partly' | 'cloud' | 'fog' | 'rain' | 'snow' | 'thunder';

export interface Condition {
  label: string;
  sky: Sky;
}

export interface Weather {
  current: {
    temperature: number;
    apparentTemperature: number;
    humidity: number;
    windSpeed: number;
    code: number;
    isDay: boolean;
  };
  hours: { label: string; temperature: number; rainChance: number; code: number; isDay: boolean }[];
  days: { label: string; high: number; low: number; rainChance: number; code: number }[];
}

const LOCATION_KEY = 'shd.weather.location';
const HOURS_SHOWN = 24;
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

export function condition(code: number): Condition {
  if (code === 0) return { label: '快晴', sky: 'clear' };
  if (code === 1) return { label: '晴れ', sky: 'clear' };
  if (code === 2) return { label: '晴れ時々くもり', sky: 'partly' };
  if (code === 3) return { label: 'くもり', sky: 'cloud' };
  if (code === 45 || code === 48) return { label: '霧', sky: 'fog' };
  if (code >= 51 && code <= 57) return { label: '霧雨', sky: 'rain' };
  if (code >= 61 && code <= 67) return { label: '雨', sky: 'rain' };
  if (code >= 71 && code <= 77) return { label: '雪', sky: 'snow' };
  if (code >= 80 && code <= 82) return { label: 'にわか雨', sky: 'rain' };
  if (code === 85 || code === 86) return { label: 'にわか雪', sky: 'snow' };
  if (code >= 95) return { label: '雷雨', sky: 'thunder' };
  return { label: '—', sky: 'cloud' };
}

export function loadLocation(): WeatherLocation | null {
  try {
    return JSON.parse(localStorage.getItem(LOCATION_KEY) ?? 'null') as WeatherLocation | null;
  } catch {
    return null;
  }
}

export function saveLocation(location: WeatherLocation) {
  try {
    localStorage.setItem(LOCATION_KEY, JSON.stringify(location));
  } catch {
    /* 保存できなくてもこの表示中は使える */
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`天気情報を取得できませんでした (${res.status})`);
  return (await res.json()) as T;
}

interface GeocodeResult {
  name: string;
  admin1?: string;
  country_code?: string;
  latitude: number;
  longitude: number;
}

async function geocode(name: string): Promise<GeocodeResult[]> {
  const params = new URLSearchParams({ name, count: '5', language: 'ja', format: 'json' });
  const body = await getJson<{ results?: GeocodeResult[] }>(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
  return body.results ?? [];
}

// ジオコーディングは完全な地名でないと日本の都市がヒットしにくい (「東京」は 0 件、「横浜」は青森の地名になる)。
// 「市」「都」などを補った検索も同時に行い、補った方の結果を優先して日本国内を先に並べる。
export async function searchLocations(query: string): Promise<WeatherLocation[]> {
  const variants = /[都道府県市区町村]$/.test(query)
    ? [query]
    : [`${query}市`, `${query}都`, `${query}区`, `${query}町`, query];
  const settled = await Promise.allSettled(variants.map(geocode));
  const failure = settled.find((s) => s.status === 'rejected');
  // 一部の検索だけ失敗しても、残りの結果は使う
  if (failure && settled.every((s) => s.status === 'rejected')) throw failure.reason;
  const found = settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []));
  const seen = new Set<string>();
  return found
    .filter((r) => {
      const key = `${r.admin1 ?? ''}/${r.name}`;
      if (seen.has(key) || !variants.includes(r.name)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => Number(b.country_code === 'JP') - Number(a.country_code === 'JP'))
    .slice(0, 5)
    .map((r) => ({
      name: r.admin1 && r.admin1 !== r.name ? `${r.admin1} ${r.name}` : r.name,
      latitude: r.latitude,
      longitude: r.longitude,
    }));
}

interface ForecastResponse {
  current: {
    time: string;
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    wind_speed_10m: number;
    weather_code: number;
    is_day: number;
  };
  hourly: {
    time: string[];
    temperature_2m: number[];
    precipitation_probability: (number | null)[];
    weather_code: number[];
    is_day: number[];
  };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: (number | null)[];
  };
}

// 時刻は現地時間の文字列 ("2026-10-31T18:00") で返るので、タイムゾーン変換せず文字列のまま扱う
function dayLabel(date: string, index: number): string {
  if (index === 0) return '今日';
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return WEEKDAYS[new Date(y, m - 1, d).getDay()]!;
}

export async function fetchWeather(location: WeatherLocation): Promise<Weather> {
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,is_day',
    hourly: 'temperature_2m,precipitation_probability,weather_code,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto',
    forecast_days: '7',
  });
  const r = await getJson<ForecastResponse>(`https://api.open-meteo.com/v1/forecast?${params}`);

  const currentHour = r.current.time.slice(0, 13);
  const start = Math.max(0, r.hourly.time.findIndex((t) => t.slice(0, 13) === currentHour));
  const hours = r.hourly.time.slice(start, start + HOURS_SHOWN).map((time, i) => {
    const at = start + i;
    return {
      label: i === 0 ? '今' : `${Number(time.slice(11, 13))}時`,
      temperature: r.hourly.temperature_2m[at]!,
      rainChance: r.hourly.precipitation_probability[at] ?? 0,
      code: r.hourly.weather_code[at]!,
      isDay: r.hourly.is_day[at] === 1,
    };
  });

  return {
    current: {
      temperature: r.current.temperature_2m,
      apparentTemperature: r.current.apparent_temperature,
      humidity: r.current.relative_humidity_2m,
      windSpeed: r.current.wind_speed_10m,
      code: r.current.weather_code,
      isDay: r.current.is_day === 1,
    },
    hours,
    days: r.daily.time.map((date, i) => ({
      label: dayLabel(date, i),
      high: r.daily.temperature_2m_max[i]!,
      low: r.daily.temperature_2m_min[i]!,
      rainChance: r.daily.precipitation_probability_max[i] ?? 0,
      code: r.daily.weather_code[i]!,
    })),
  };
}
