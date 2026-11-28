import type { ReactNode } from 'react';
import type { Kind } from '../../../api/src/types';
import type { Sky } from '../weather';

function Svg({ size = 24, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const CLOUD = 'M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 11.1 3.5 3.5 0 0 0 7 18Z';
const LOW_CLOUD = 'M7 15h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 8.1 3.5 3.5 0 0 0 7 15Z';

export function SkyIcon({ sky, isDay = true, size }: { sky: Sky; isDay?: boolean; size?: number }) {
  switch (sky) {
    case 'clear':
      return isDay ? (
        <Svg size={size}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
        </Svg>
      ) : (
        <Svg size={size}>
          <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
        </Svg>
      );
    case 'partly':
      return (
        <Svg size={size}>
          {isDay ? (
            <>
              <circle cx="8" cy="8" r="3" />
              <path d="M8 2.5v1M2.5 8h1M4.1 4.1l.7.7M11.9 4.1l-.7.7" />
            </>
          ) : (
            <path d="M12 6.5A4.5 4.5 0 1 1 6.5 2a3.6 3.6 0 0 0 5.5 4.5Z" />
          )}
          <path d="M9 20h8a3.5 3.5 0 0 0 .5-7 5 5 0 0 0-9.5.9A3 3 0 0 0 9 20Z" />
        </Svg>
      );
    case 'cloud':
      return (
        <Svg size={size}>
          <path d={CLOUD} />
        </Svg>
      );
    case 'fog':
      return (
        <Svg size={size}>
          <path d={LOW_CLOUD} />
          <path d="M5 18.5h14M8 21.5h8" />
        </Svg>
      );
    case 'rain':
      return (
        <Svg size={size}>
          <path d={LOW_CLOUD} />
          <path d="m8.5 18-1 3M12.5 18l-1 3M16.5 18l-1 3" />
        </Svg>
      );
    case 'snow':
      return (
        <Svg size={size}>
          <path d={LOW_CLOUD} />
          <path d="M8 18.5v.01M12 18.5v.01M16 18.5v.01M10 21.5v.01M14 21.5v.01" strokeWidth={2.2} />
        </Svg>
      );
    case 'thunder':
      return (
        <Svg size={size}>
          <path d={LOW_CLOUD} />
          <path d="m12.5 16.5-2 3h3l-2 3" />
        </Svg>
      );
  }
}

export function KindIcon({ kind, size = 20 }: { kind: Kind; size?: number }) {
  switch (kind) {
    case 'aircon':
      return (
        <Svg size={size}>
          <rect x="3" y="5" width="18" height="8" rx="2" />
          <path d="M7 10h10M7.5 16.5c0 1.5-1 1.5-1 3M12 16.5c0 1.5-1 1.5-1 3M16.5 16.5c0 1.5-1 1.5-1 3" />
        </Svg>
      );
    case 'light':
      return (
        <Svg size={size}>
          <path d="M9 17h6M10 20.5h4M12 3a6 6 0 0 0-3.5 10.9c.4.3.5.7.5 1.1v2h6v-2c0-.4.1-.8.5-1.1A6 6 0 0 0 12 3Z" />
        </Svg>
      );
    case 'curtain':
      return (
        <Svg size={size}>
          <path d="M3 4h18M5 4v16M19 4v16M5 20c3-3 4-9 4-16M19 20c-3-3-4-9-4-16" />
        </Svg>
      );
    case 'tv':
      return (
        <Svg size={size}>
          <rect x="3" y="5" width="18" height="12" rx="2" />
          <path d="M8 21h8" />
        </Svg>
      );
    case 'ir':
      return (
        <Svg size={size}>
          <rect x="7" y="3" width="10" height="18" rx="3" />
          <path d="M12 7v.01M10 12h4M10 15.5h4" strokeWidth={1.8} />
        </Svg>
      );
    default:
      return (
        <Svg size={size}>
          <path d="M12 3v8M7.5 6.5a7.5 7.5 0 1 0 9 0" />
        </Svg>
      );
  }
}

// ---- メニュー用 (左メニュー・下のタブ) ----
const navSvg = (size: number, d: ReactNode) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);
export const NavAll = ({ size = 20 }: { size?: number }) =>
  navSvg(size, <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>);
export const NavRoom = ({ size = 20 }: { size?: number }) =>
  navSvg(size, <><path d="M4 21V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16" /><path d="M2 21h20M15 12h.01" /></>);
export const NavRefresh = ({ size = 20 }: { size?: number }) =>
  navSvg(size, <><path d="M21 12a9 9 0 1 1-2.64-6.36L21 8" /><path d="M21 3v5h-5" /></>);
export const NavLogout = ({ size = 20 }: { size?: number }) =>
  navSvg(size, <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></>);
export const NavApps = ({ size = 20 }: { size?: number }) =>
  navSvg(size, <><path d="M15 3h6v6M10 14L21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>);
export const NavAutomation = ({ size = 20 }: { size?: number }) =>
  navSvg(size, <><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" /></>);
