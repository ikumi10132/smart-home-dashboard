import type { Command, Device } from '../../../api/src/types';
import { devicesInRoom, type Room } from '../rooms';
import { DeviceCard } from './DeviceCard';

interface Props {
  room: Room;
  devices: Device[];
  onCommand: (device: Device, command: Command) => Promise<void>;
}

export function RoomPanel({ room, devices, onCommand }: Props) {
  const { sensors, controls } = devicesInRoom(devices, room);
  const running = controls.filter((d) => d.state.power === 'on').length;
  const climate = sensors.filter((s) => s.state.temperature !== undefined || s.state.humidity !== undefined);

  return (
    <section className="panel room" aria-label={room.name}>
      <header className="room-head">
        <div>
          <h2>{room.name}</h2>
          <p className="room-sub">
            {controls.length}台{running > 0 && <span className="room-running"> · {running}台ON</span>}
          </p>
        </div>
        {climate.length > 0 ? (
          <div className="room-climate">
            {climate.map((s) => (
              <div key={s.id} className="climate-reading" title={s.name}>
                {s.state.temperature !== undefined && (
                  <p className="room-temp">{s.state.temperature.toFixed(1)}<small>℃</small></p>
                )}
                {s.state.humidity !== undefined && <p className="room-humidity">湿度 {Math.round(s.state.humidity)}%</p>}
              </div>
            ))}
          </div>
        ) : (
          <p className="room-no-sensor">室温センサーなし</p>
        )}
      </header>
      {controls.length > 0 ? (
        <div className="grid">
          {controls.map((d) => (
            <DeviceCard key={d.id} device={d} onCommand={onCommand} />
          ))}
        </div>
      ) : (
        <p className="muted small">操作できる機器はありません</p>
      )}
    </section>
  );
}
