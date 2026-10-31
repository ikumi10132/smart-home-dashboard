import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  condition,
  fetchWeather,
  loadLocation,
  saveLocation,
  searchLocations,
  type Weather,
  type WeatherLocation,
} from '../weather';
import { SkyIcon } from './Icons';

const POLL_MS = 15 * 60_000;

const round = (n: number) => Math.round(n);

export function WeatherPanel() {
  const [location, setLocation] = useState<WeatherLocation | null>(loadLocation);
  const [editing, setEditing] = useState(false);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async (target: WeatherLocation) => {
    try {
      setWeather(await fetchWeather(target));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    if (!location) return;
    void refresh(location);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh(location);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [location, refresh]);

  const choose = (next: WeatherLocation) => {
    saveLocation(next);
    setWeather(null);
    setFailed(false);
    setLocation(next);
    setEditing(false);
  };

  if (!location || editing) {
    return (
      <section className="panel weather weather-setup" aria-label="天気">
        <LocationForm onChoose={choose} onCancel={location ? () => setEditing(false) : undefined} />
      </section>
    );
  }

  const sky = weather ? condition(weather.current.code) : null;

  return (
    <section className={`panel weather${sky ? ` sky-${sky.sky}` : ''}${weather && !weather.current.isDay ? ' is-night' : ''}`} aria-label="天気">
      <div className="weather-now">
        <button className="link-button" onClick={() => setEditing(true)} aria-label={`地域を変更 (現在: ${location.name})`}>
          {location.name}
        </button>
        {weather && sky ? (
          <>
            <div className="weather-hero">
              <span className="weather-hero-icon"><SkyIcon sky={sky.sky} isDay={weather.current.isDay} size={56} /></span>
              <p className="hero-number">
                {weather.current.temperature.toFixed(1)}
                <small>℃</small>
              </p>
            </div>
            <p className="weather-label">{sky.label}</p>
            <dl className="weather-facts">
              <div><dt>体感</dt><dd>{round(weather.current.apparentTemperature)}℃</dd></div>
              <div><dt>湿度</dt><dd>{round(weather.current.humidity)}%</dd></div>
              <div><dt>風速</dt><dd>{(weather.current.windSpeed / 3.6).toFixed(1)}m/s</dd></div>
            </dl>
          </>
        ) : (
          <p className="muted weather-status">
            {failed ? '天気情報を取得できませんでした' : '天気を読み込み中…'}
          </p>
        )}
      </div>

      {weather && (
        <>
          <ol className="hours" aria-label="24時間の予報" tabIndex={0}>
            {weather.hours.map((h) => (
              <li key={h.label}>
                <span className="hour-label">{h.label}</span>
                <SkyIcon sky={condition(h.code).sky} isDay={h.isDay} size={22} />
                <span className="hour-temp">{round(h.temperature)}°</span>
                <span className="hour-rain">{h.rainChance}%</span>
              </li>
            ))}
          </ol>
          <ol className="days" aria-label="週間予報">
            {weather.days.map((d) => (
              <li key={d.label}>
                <span className="day-label">{d.label}</span>
                <SkyIcon sky={condition(d.code).sky} size={20} />
                <span className="day-rain">{d.rainChance}%</span>
                <span className="day-temps"><b>{round(d.high)}°</b> <span>{round(d.low)}°</span></span>
              </li>
            ))}
          </ol>
          <a className="credit" href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather data by Open-Meteo.com</a>
        </>
      )}
    </section>
  );
}

function LocationForm({ onChoose, onCancel }: { onChoose: (l: WeatherLocation) => void; onCancel?: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<WeatherLocation[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setFailed(false);
    try {
      setResults(await searchLocations(query.trim()));
    } catch {
      setFailed(true);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="location-form">
      <h2>天気を表示する地域</h2>
      <form onSubmit={(e) => void submit(e)}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="市区町村名（例: 横浜）"
          aria-label="市区町村名"
          autoFocus
        />
        <button className="btn btn-primary" disabled={searching || !query.trim()}>
          {searching ? '検索中…' : '検索'}
        </button>
        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>戻る</button>}
      </form>
      {failed && <p className="error-text small">検索できませんでした。もう一度お試しください</p>}
      {results?.length === 0 && <p className="muted small">見つかりませんでした。近くの市の名前でお試しください</p>}
      {results && results.length > 0 && (
        <ul className="location-results">
          {results.map((r) => (
            <li key={`${r.latitude},${r.longitude}`}>
              <button className="btn" onClick={() => onChoose(r)}>{r.name}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
