// 5 分ごとに EventBridge から呼ばれ、オートメーションを判定して操作を送る
import { decide, stateDeviceIds } from './automation.js';
import { claimRun, listAutomations, saveRunResult, saveTriggerMet } from './automation-store.js';
import { deviceStates, runActions } from './clients.js';

export async function handler(): Promise<void> {
  const now = new Date();
  const automations = (await listAutomations()).filter((a) => a.enabled);
  // 状態を使うものがあるときだけ、その機器の状態を読む (API の回数を節約)
  const ids = automations.flatMap(stateDeviceIds);
  const states = ids.length ? await deviceStates(ids) : new Map();

  for (const a of automations) {
    const d = decide(a, states, now);
    if (d.triggerMet !== undefined && !(await saveTriggerMet(a.id, a.updatedAt, d.triggerMet))) {
      continue; // 判定中に画面から保存された。次回、保存した内容で判定する
    }
    const key = d.runKey ?? d.skipKey;
    if (!key || !(await claimRun(a.id, key))) continue;
    if (!d.runKey) {
      console.log(JSON.stringify({ automation: a.id, key, skipped: '条件を満たさない' }));
      continue;
    }
    const results = await runActions(a.actions);
    const ok = results.every((r) => r.ok);
    await saveRunResult(a.id, { at: new Date().toISOString(), ok, results });
    console.log(JSON.stringify({ automation: a.id, key, ok, results }));
  }
}
