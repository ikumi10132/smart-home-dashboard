import type { Device } from '../../../api/src/types';

export function SensorStrip({ sensors }: { sensors: Device[] }) {
  if (!sensors.length) return null;
  return (
    <section className="sensors" aria-label="温湿度">
      {sensors.map((s) => (
        <div key={s.id} className="sensor">
          <p className="sensor-name">{s.name}</p>
          <p className="sensor-values">
            {s.state.temperature !== undefined && (
              <span>
                <strong>{s.state.temperature.toFixed(1)}</strong>℃
              </span>
            )}
            {s.state.humidity !== undefined && (
              <span>
                <strong>{Math.round(s.state.humidity)}</strong>%
              </span>
            )}
          </p>
          {s.state.battery !== undefined && <p className="sensor-sub">電池 {s.state.battery}%</p>}
        </div>
      ))}
    </section>
  );
}
