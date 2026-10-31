import type { Device, Kind, Provider } from '../../api/src/types';

export interface Room {
  id: string;
  name: string;
  /** この部屋に置いてあるハブ。機器はハブ単位で部屋に振り分ける */
  provider: Provider;
}

export const ROOMS: Room[] = [
  { id: 'living', name: 'リビング', provider: 'switchbot' },
  { id: 'bedroom', name: '寝室', provider: 'remo' },
];

const KIND_ORDER: Kind[] = ['aircon', 'light', 'switch', 'bot', 'curtain', 'tv', 'ir'];

export function devicesInRoom(devices: Device[], room: Room) {
  const inRoom = devices.filter((d) => d.provider === room.provider);
  return {
    sensors: inRoom.filter((d) => d.kind === 'sensor'),
    controls: inRoom
      .filter((d) => d.kind !== 'sensor')
      .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)),
  };
}
