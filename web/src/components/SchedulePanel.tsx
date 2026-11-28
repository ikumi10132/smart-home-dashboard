import { useCallback, useEffect, useState } from 'react';
import type { AirconMode, Command, Device, Schedule, ScheduleAction, ScheduleInput, ScheduleRunResult, Weekday } from '../../../api/src/types';
import { createSchedule, deleteSchedule, fetchSchedules, runSchedule, updateSchedule } from '../api';
import {
  commandKey,
  commandOptions,
  DAY_PRESETS,
  defaultCommand,
  describeCommand,
  describeDays,
  MODE_LABEL,
  nearest,
  schedulableDevices,
  WEEKDAYS,
} from '../schedule-format';

interface Props {
  /** 機器の一覧 (読み込み中は null) */
  devices: Device[] | null;
  onError: (e: unknown) => void;
  showToast: (text: string, error?: boolean) => void;
}

type Editing = { id?: string; draft: ScheduleInput };

const MAX_ACTIONS = 10;

const emptyDraft = (): ScheduleInput => ({ name: '', enabled: true, days: [1, 2, 3, 4, 5], time: '07:00', actions: [] });

export function SchedulePanel({ devices, onError, showToast }: Props) {
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setSchedules(await fetchSchedules());
    } catch (e) {
      onError(e);
    }
  }, [onError]);

  useEffect(() => void reload(), [reload]);

  const withBusy = async (id: string, fn: () => Promise<void>) => {
    if (busyId) return;
    setBusyId(id);
    try {
      await fn();
    } catch (e) {
      onError(e);
    } finally {
      setBusyId(null);
    }
  };

  const save = async (input: ScheduleInput) => {
    try {
      if (editing?.id) await updateSchedule(editing.id, input);
      else await createSchedule(input);
      showToast(`「${input.name}」を保存しました`);
      setEditing(null);
      await reload();
    } catch (e) {
      onError(e);
    }
  };

  const toggle = (s: Schedule) =>
    withBusy(s.id, async () => {
      const { name, enabled, days, time, actions } = s;
      await updateSchedule(s.id, { name, enabled: !enabled, days, time, actions });
      await reload();
    });

  const remove = (s: Schedule) => {
    if (!confirm(`「${s.name}」を削除しますか?`)) return;
    void withBusy(s.id, async () => {
      await deleteSchedule(s.id);
      showToast(`「${s.name}」を削除しました`);
      await reload();
    });
  };

  const runNow = (s: Schedule) =>
    withBusy(s.id, async () => {
      const r = await runSchedule(s.id);
      showToast(r.ok ? `「${s.name}」を実行しました` : `一部失敗しました: ${failures(r)}`, !r.ok);
    });

  if (editing) {
    return (
      <ScheduleEditor
        initial={editing.draft}
        isNew={!editing.id}
        devices={devices}
        onCancel={() => setEditing(null)}
        onSave={save}
      />
    );
  }

  const byId = new Map((devices ?? []).map((d) => [d.id, d]));

  return (
    <section className="panel schedules" aria-label="スケジュール">
      <header className="tasks-head">
        <div>
          <h2>スケジュール</h2>
          <p className="muted small">曜日と時刻 (日本時間) を決めて、家電をまとめて操作します</p>
        </div>
        <button className="btn btn-small btn-primary" onClick={() => setEditing({ draft: emptyDraft() })}>
          ＋ 追加
        </button>
      </header>

      {!schedules && <p className="muted small">読み込み中…</p>}
      {schedules?.length === 0 && <p className="muted small">まだスケジュールはありません。「＋ 追加」から作れます</p>}

      <ul className="schedule-list">
        {schedules?.map((s) => (
          <li key={s.id} className={`schedule${s.enabled ? '' : ' is-off'}${busyId === s.id ? ' is-busy' : ''}`}>
            <div className="schedule-head">
              <div className="schedule-when">
                <span className="schedule-time">{s.time}</span>
                <span className="schedule-days">{describeDays(s.days)}</span>
              </div>
              <button
                role="switch"
                aria-checked={s.enabled}
                aria-label={`${s.name} を${s.enabled ? '止める' : '有効にする'}`}
                className={`switch${s.enabled ? ' on' : ''}`}
                disabled={busyId !== null}
                onClick={() => void toggle(s)}
              >
                <span />
              </button>
            </div>
            <h3 className="schedule-name">{s.name}</h3>
            <ul className="schedule-actions">
              {s.actions.map((a, i) => (
                <li key={i}>
                  <strong>{byId.get(a.deviceId)?.name ?? a.deviceName}</strong>
                  <span className="muted"> → {describeCommand(a.command, byId.get(a.deviceId))}</span>
                  {devices && !byId.has(a.deviceId) && <span className="task-tag task-tag-due">機器が見つかりません</span>}
                </li>
              ))}
            </ul>
            {s.lastRun && <LastRun run={s.lastRun} />}
            <div className="btn-row schedule-buttons">
              <button className="btn btn-small" disabled={busyId !== null} onClick={() => void runNow(s)}>
                {busyId === s.id ? '実行中…' : '今すぐ実行'}
              </button>
              <button
                className="btn btn-small"
                disabled={busyId !== null}
                onClick={() => {
                  const { name, enabled, days, time, actions } = s;
                  setEditing({ id: s.id, draft: { name, enabled, days, time, actions } });
                }}
              >
                編集
              </button>
              <button className="btn btn-small btn-ghost btn-danger" disabled={busyId !== null} onClick={() => remove(s)}>
                削除
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

const failures = (r: ScheduleRunResult) =>
  r.results
    .filter((x) => !x.ok)
    .map((x) => `${x.deviceName} (${x.message ?? 'エラー'})`)
    .join('、');

function LastRun({ run }: { run: ScheduleRunResult }) {
  const at = new Date(run.at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return (
    <p className={`small ${run.ok ? 'muted' : 'error-text'}`}>
      前回 {at} {run.ok ? '· 成功' : `· 失敗: ${failures(run)}`}
    </p>
  );
}

// ---------- 編集画面 ----------

interface EditorProps {
  initial: ScheduleInput;
  isNew: boolean;
  devices: Device[] | null;
  onCancel: () => void;
  onSave: (input: ScheduleInput) => Promise<void>;
}

function ScheduleEditor({ initial, isNew, devices, onCancel, onSave }: EditorProps) {
  const [draft, setDraft] = useState<ScheduleInput>(initial);
  const [saving, setSaving] = useState(false);
  const candidates = schedulableDevices(devices ?? []);
  const byId = new Map(candidates.map((d) => [d.id, d]));

  const set = (patch: Partial<ScheduleInput>) => setDraft((d) => ({ ...d, ...patch }));
  const setAction = (i: number, a: ScheduleAction) => set({ actions: draft.actions.map((x, j) => (j === i ? a : x)) });
  const toggleDay = (day: Weekday) =>
    set({ days: draft.days.includes(day) ? draft.days.filter((d) => d !== day) : [...draft.days, day] });

  const addAction = () => {
    const device = candidates[0];
    if (!device) return;
    set({ actions: [...draft.actions, { deviceId: device.id, deviceName: device.name, command: defaultCommand(device) }] });
  };
  const moveAction = (i: number, delta: -1 | 1) => {
    const actions = [...draft.actions];
    const [a] = actions.splice(i, 1);
    actions.splice(i + delta, 0, a!);
    set({ actions });
  };

  const problem = !draft.name.trim()
    ? '名前を入力してください'
    : !draft.days.length
      ? '曜日を 1 つ以上選んでください'
      : !draft.actions.length
        ? '操作を 1 つ以上追加してください'
        : null;

  const submit = async () => {
    if (problem || saving) return;
    setSaving(true);
    try {
      await onSave({ ...draft, name: draft.name.trim() });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="panel schedules editor" aria-label={isNew ? 'スケジュールの追加' : 'スケジュールの編集'}>
      <header className="tasks-head">
        <h2>{isNew ? 'スケジュールの追加' : 'スケジュールの編集'}</h2>
        <button className="btn btn-small btn-ghost" onClick={onCancel}>キャンセル</button>
      </header>

      <label className="field">
        <span>名前</span>
        <input
          className="input"
          value={draft.name}
          maxLength={40}
          placeholder="例: 朝の暖房"
          onChange={(e) => set({ name: e.target.value })}
        />
      </label>

      <div className="field-row">
        <label className="field">
          <span>時刻 (日本時間)</span>
          <input className="input input-time" type="time" required value={draft.time} onChange={(e) => e.target.value && set({ time: e.target.value })} />
        </label>
        <label className="field field-inline">
          <input type="checkbox" checked={draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          <span>有効にする</span>
        </label>
      </div>

      <fieldset className="field">
        <legend>曜日</legend>
        <div className="day-picker">
          {WEEKDAYS.map((w) => (
            <button
              key={w.day}
              type="button"
              aria-pressed={draft.days.includes(w.day)}
              className={`day${draft.days.includes(w.day) ? ' active' : ''}${w.day === 0 ? ' sun' : w.day === 6 ? ' sat' : ''}`}
              onClick={() => toggleDay(w.day)}
            >
              {w.label}
            </button>
          ))}
        </div>
        <div className="day-presets">
          {DAY_PRESETS.map((p) => (
            <button key={p.label} type="button" className="link-button" onClick={() => set({ days: p.days })}>
              {p.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend>操作 (上から順に実行)</legend>
        {!devices && <p className="muted small">機器を読み込み中…</p>}
        <ol className="action-list">
          {draft.actions.map((a, i) => {
            const device = byId.get(a.deviceId);
            return (
              <li key={i} className="action-row">
                <div className="action-top">
                  <span className="action-no">{i + 1}</span>
                  <select
                    className="input"
                    aria-label={`操作 ${i + 1} の機器`}
                    value={device ? a.deviceId : ''}
                    onChange={(e) => {
                      const d = byId.get(e.target.value);
                      if (d) setAction(i, { deviceId: d.id, deviceName: d.name, command: defaultCommand(d) });
                    }}
                  >
                    {!device && <option value="">{a.deviceName} (見つかりません)</option>}
                    {candidates.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                  <div className="action-tools">
                    <button type="button" className="btn btn-small btn-ghost" aria-label="上へ" disabled={i === 0} onClick={() => moveAction(i, -1)}>↑</button>
                    <button type="button" className="btn btn-small btn-ghost" aria-label="下へ" disabled={i === draft.actions.length - 1} onClick={() => moveAction(i, 1)}>↓</button>
                    <button
                      type="button"
                      className="btn btn-small btn-ghost btn-danger"
                      aria-label="この操作を削除"
                      onClick={() => set({ actions: draft.actions.filter((_, j) => j !== i) })}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                {device ? (
                  <CommandPicker device={device} command={a.command} onChange={(command) => setAction(i, { ...a, command })} />
                ) : (
                  <p className="muted small">{describeCommand(a.command)}</p>
                )}
              </li>
            );
          })}
        </ol>
        <button
          type="button"
          className="btn btn-small"
          disabled={!candidates.length || draft.actions.length >= MAX_ACTIONS}
          onClick={addAction}
        >
          ＋ 操作を追加
        </button>
      </fieldset>

      {problem && <p className="muted small">{problem}</p>}
      <div className="btn-row">
        <button className="btn btn-primary" disabled={!!problem || saving} onClick={() => void submit()}>
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </section>
  );
}

function CommandPicker({ device, command, onChange }: { device: Device; command: Command; onChange: (c: Command) => void }) {
  if (device.kind === 'aircon') return <AirconPicker device={device} command={command} onChange={onChange} />;
  const options = commandOptions(device);
  return (
    <div className="chip-row" role="radiogroup" aria-label={`${device.name} の操作`}>
      {options.map((o) => {
        const active = commandKey(o.command) === commandKey(command);
        return (
          <button key={commandKey(o.command)} type="button" role="radio" aria-checked={active} className={`chip${active ? ' active' : ''}`} onClick={() => onChange(o.command)}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function AirconPicker({ device, command, onChange }: { device: Device; command: Command; onChange: (c: Command) => void }) {
  const modes = device.aircon?.modes ?? [];
  const current = command.action === 'aircon' ? command : { action: 'aircon' as const, power: 'on' as const };
  const mode: AirconMode = current.mode ?? (modes.includes('cool') ? 'cool' : (modes[0] ?? 'cool'));
  const temps = device.aircon?.temperatures[mode] ?? [];

  const update = (power: 'on' | 'off', m: AirconMode, temperature?: number) => {
    const ts = device.aircon?.temperatures[m] ?? [];
    onChange({ action: 'aircon', power, mode: m, temperature: ts.length ? nearest(ts, temperature ?? 26) : undefined });
  };

  return (
    <div className="aircon-picker">
      <div className="segmented" role="radiogroup" aria-label="運転か停止か">
        {(['on', 'off'] as const).map((p) => (
          <button key={p} type="button" role="radio" aria-checked={current.power === p} className={current.power === p ? 'active' : ''} onClick={() => update(p, mode, current.temperature)}>
            {p === 'on' ? '運転' : '停止'}
          </button>
        ))}
      </div>
      {current.power === 'on' && (
        <div className="field-row">
          <select className="input" aria-label="運転モード" value={mode} onChange={(e) => update('on', e.target.value as AirconMode, current.temperature)}>
            {modes.map((m) => (
              <option key={m} value={m}>
                {MODE_LABEL[m]}
              </option>
            ))}
          </select>
          {temps.length > 0 ? (
            <select
              className="input"
              aria-label="温度"
              value={current.temperature ?? nearest(temps, 26)}
              onChange={(e) => update('on', mode, Number(e.target.value))}
            >
              {temps.map((t) => (
                <option key={t} value={t}>
                  {t}℃
                </option>
              ))}
            </select>
          ) : (
            <span className="muted small">温度設定なし</span>
          )}
        </div>
      )}
    </div>
  );
}
