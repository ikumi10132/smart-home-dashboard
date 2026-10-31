import { useEffect, useState } from 'react';

export function Clock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="clock">
      <p className="clock-time">{now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</p>
      <p className="clock-date">{now.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' })}</p>
    </div>
  );
}
