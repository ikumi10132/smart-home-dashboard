// 1 分ごとに EventBridge から呼ばれ、時刻が来たスケジュールの操作を送る
import { runActions } from './clients.js';
import { dueRunKey } from './schedule.js';
import { claimRun, listSchedules, saveRunResult } from './schedule-store.js';

export async function handler(): Promise<void> {
  const now = new Date();
  const schedules = await listSchedules();
  for (const s of schedules) {
    const key = dueRunKey(s, s.lastRunKey, now);
    if (!key || !(await claimRun(s.id, key))) continue;
    const results = await runActions(s.actions);
    const ok = results.every((r) => r.ok);
    await saveRunResult(s.id, { at: new Date().toISOString(), ok, results });
    console.log(JSON.stringify({ schedule: s.id, key, ok, results }));
  }
}
