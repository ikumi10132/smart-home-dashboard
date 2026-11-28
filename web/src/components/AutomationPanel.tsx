import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type {
  AirconMode,
  Automation,
  AutomationInput,
  Command,
  Condition,
  Device,
  ScheduleAction,
  ScheduleRunResult,
  StateCondition,
  Trigger,
  Weekday,
} from '../../../api/src/types';
import { createAutomation, deleteAutomation, fetchAutomations, runAutomation, updateAutomation } from '../api';
import {
  actionDevices,
  commandKey,
  commandOptions,
  conditionDeviceIds,
  COOLDOWN_CHOICES,
  DAY_PRESETS,
  defaultCommand,
  defaultStateCondition,
  describeCommand,
  describeCondition,
  describeDays,
  describeTrigger,
  HOURS,
  METRIC_LABEL,
  METRIC_UNIT,
  metricsOf,
  MINUTES,
  MODE_LABEL,
  nearest,
  powerDevices,
  sensorDevices,
  WEEKDAYS,
} from '../automation-format';

interface Props {
  /** 機器の一覧 (読み込み中は null) */
  devices: Device[] | null;
  onError: (e: unknown) => void;
  showToast: (text: string, error?: boolean) => void;
}

type Editing = { id?: string; draft: AutomationInput };

const MAX_ACTIONS = 10;
const MAX_CONDITIONS = 5;

const emptyDraft = (): AutomationInput => ({
  name: '',
  enabled: true,
  trigger: { type: 'time', days: [1, 2, 3, 4, 5], time: '07:00' },
  conditions: [],
  actions: [],
  cooldownMinutes: 30,
});

const toInput = ({ name, enabled, trigger, conditions, actions, cooldownMinutes }: Automation): AutomationInput => ({
  name,
  enabled,
  trigger,
  conditions,
  actions,
  cooldownMinutes,
});

export function AutomationPanel({ devices, onError, showToast }: Props) {
  const [automations, setAutomations] = useState<Automation[] | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setAutomations(await fetchAutomations());
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

  const save = async (input: AutomationInput) => {
    try {
      if (editing?.id) await updateAutomation(editing.id, input);
      else await createAutomation(input);
      showToast(`「${input.name}」を保存しました`);
      setEditing(null);
      await reload();
    } catch (e) {
      onError(e);
    }
  };

  const toggle = (a: Automation) =>
    withBusy(a.id, async () => {
      await updateAutomation(a.id, { ...toInput(a), enabled: !a.enabled });
      await reload();
    });

  const remove = (a: Automation) => {
    if (!confirm(`「${a.name}」を削除しますか?`)) return;
    void withBusy(a.id, async () => {
      await deleteAutomation(a.id);
      showToast(`「${a.name}」を削除しました`);
      await reload();
    });
  };

  const runNow = (a: Automation) =>
    withBusy(a.id, async () => {
      const r = await runAutomation(a.id);
      showToast(r.ok ? `「${a.name}」の操作を実行しました` : `一部失敗しました: ${failures(r)}`, !r.ok);
    });

  if (editing) {
    return (
      <AutomationEditor
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
    <section className="panel schedules" aria-label="オートメーション">
      <header className="tasks-head">
        <div>
          <h2>オートメーション</h2>
          <p className="muted small">「もし〜なら、〜する」を組み合わせて家電を自動で操作します (5 分ごとに判定)</p>
        </div>
        <button className="btn btn-small btn-primary" onClick={() => setEditing({ draft: emptyDraft() })}>
          ＋ 追加
        </button>
      </header>

      {!automations && <p className="muted small">読み込み中…</p>}
      {automations?.length === 0 && <p className="muted small">まだありません。「＋ 追加」から作れます</p>}

      <ul className="schedule-list">
        {automations?.map((a) => {
          const missing = devices ? [...conditionDeviceIds(a), ...a.actions.map((x) => x.deviceId)].some((id) => !byId.has(id)) : false;
          return (
            <li key={a.id} className={`schedule${a.enabled ? '' : ' is-off'}${busyId === a.id ? ' is-busy' : ''}`}>
              <div className="schedule-head">
                <h3 className="schedule-name">{a.name}</h3>
                <button
                  role="switch"
                  aria-checked={a.enabled}
                  aria-label={`${a.name} を${a.enabled ? '止める' : '有効にする'}`}
                  className={`switch${a.enabled ? ' on' : ''}`}
                  disabled={busyId !== null}
                  onClick={() => void toggle(a)}
                >
                  <span />
                </button>
              </div>
              {a.trigger.type === 'time' ? (
                <div className="schedule-when">
                  <span className="schedule-time">{a.trigger.time}</span>
                  <span className="schedule-days">{describeDays(a.trigger.days)}</span>
                </div>
              ) : (
                <p className="rule-line">
                  <span className="rule-tag rule-tag-if">もし</span>
                  {describeTrigger(a.trigger, byId)}
                </p>
              )}
              {a.conditions.length > 0 && (
                <p className="rule-line">
                  <span className="rule-tag">条件</span>
                  {a.conditions.map((c) => describeCondition(c, byId)).join('、')}
                </p>
              )}
              <ul className="schedule-actions">
                {a.actions.map((x, i) => (
                  <li key={i}>
                    <span className="muted">→</span>
                    <strong>{byId.get(x.deviceId)?.name ?? x.deviceName}</strong>
                    <span className="muted">{describeCommand(x.command, byId.get(x.deviceId))}</span>
                  </li>
                ))}
              </ul>
              {missing && <p className="small error-text">見つからない機器があります。編集して選び直してください</p>}
              {a.lastRun && <LastRun run={a.lastRun} />}
              <div className="btn-row schedule-buttons">
                <button className="btn btn-small" disabled={busyId !== null} onClick={() => void runNow(a)}>
                  {busyId === a.id ? '実行中…' : '今すぐ実行'}
                </button>
                <button className="btn btn-small" disabled={busyId !== null} onClick={() => setEditing({ id: a.id, draft: toInput(a) })}>
                  編集
                </button>
                <button className="btn btn-small btn-ghost btn-danger" disabled={busyId !== null} onClick={() => remove(a)}>
                  削除
                </button>
              </div>
            </li>
          );
        })}
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
  initial: AutomationInput;
  isNew: boolean;
  devices: Device[] | null;
  onCancel: () => void;
  onSave: (input: AutomationInput) => Promise<void>;
}

function AutomationEditor({ initial, isNew, devices, onCancel, onSave }: EditorProps) {
  const [draft, setDraft] = useState<AutomationInput>(initial);
  const [saving, setSaving] = useState(false);
  const all = devices ?? [];
  const candidates = actionDevices(all);
  const byId = new Map(all.map((d) => [d.id, d]));

  const set = (patch: Partial<AutomationInput>) => setDraft((d) => ({ ...d, ...patch }));
  const setAction = (i: number, a: ScheduleAction) => set({ actions: draft.actions.map((x, j) => (j === i ? a : x)) });
  const setCondition = (i: number, c: Condition) => set({ conditions: draft.conditions.map((x, j) => (j === i ? c : x)) });

  const setTriggerType = (type: Trigger['type']) => {
    if (type === draft.trigger.type) return;
    if (type === 'time') return set({ trigger: { type: 'time', days: [1, 2, 3, 4, 5], time: '07:00' } });
    const condition = defaultStateCondition('sensor', all) ?? defaultStateCondition('power', all);
    if (condition) set({ trigger: { type: 'state', condition } });
  };
  const canUseState = !!(defaultStateCondition('sensor', all) ?? defaultStateCondition('power', all));

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
    : draft.trigger.type === 'time' && !draft.trigger.days.length
      ? '曜日を 1 つ以上選んでください'
      : draft.conditions.some((c) => c.type === 'days' && !c.days.length)
        ? '条件の曜日を 1 つ以上選んでください'
        : draft.conditions.some((c) => c.type === 'timeRange' && c.from === c.to)
          ? '時間帯の始まりと終わりが同じです'
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
    <section className="panel schedules editor" aria-label={isNew ? 'オートメーションの追加' : 'オートメーションの編集'}>
      <header className="tasks-head">
        <h2>{isNew ? 'オートメーションの追加' : 'オートメーションの編集'}</h2>
        <button className="btn btn-small btn-ghost" onClick={onCancel}>キャンセル</button>
      </header>

      <label className="field">
        <span>名前</span>
        <input className="input" value={draft.name} maxLength={40} placeholder="例: 暑くなったら冷房" onChange={(e) => set({ name: e.target.value })} />
      </label>

      {!devices && <p className="muted small">機器を読み込み中…</p>}

      {/* ---- もし (きっかけ) ---- */}
      <Step tag="もし" title="きっかけ">
        <div className="segmented" role="radiogroup" aria-label="きっかけの種類">
          <button type="button" role="radio" aria-checked={draft.trigger.type === 'time'} className={draft.trigger.type === 'time' ? 'active' : ''} onClick={() => setTriggerType('time')}>
            時刻になったら
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={draft.trigger.type === 'state'}
            className={draft.trigger.type === 'state' ? 'active' : ''}
            disabled={!canUseState}
            onClick={() => setTriggerType('state')}
          >
            状態が変わったら
          </button>
        </div>
        {draft.trigger.type === 'time' ? (
          <>
            <TimeSelect label="時刻 (日本時間)" value={draft.trigger.time} onChange={(time) => set({ trigger: { ...(draft.trigger as Extract<Trigger, { type: 'time' }>), time } })} />
            <DayPicker days={draft.trigger.days} onChange={(days) => set({ trigger: { ...(draft.trigger as Extract<Trigger, { type: 'time' }>), days } })} />
          </>
        ) : (
          <>
            <StateConditionEditor devices={all} value={draft.trigger.condition} onChange={(condition) => set({ trigger: { type: 'state', condition } })} suffix="になったら" />
            <p className="muted small">
              満たしていない状態から満たした状態に変わったときに 1 回動きます。保存した時点ですでに満たしているときは、一度外れてから動きます
            </p>
            <label className="field">
              <span>一度動いたら、次に動くまで空ける時間</span>
              <select className="input" value={draft.cooldownMinutes} onChange={(e) => set({ cooldownMinutes: Number(e.target.value) })}>
                {COOLDOWN_CHOICES.map((c) => (
                  <option key={c.minutes} value={c.minutes}>{c.label}</option>
                ))}
              </select>
            </label>
          </>
        )}
      </Step>

      {/* ---- かつ (条件) ---- */}
      <Step tag="かつ" title="条件 (任意。すべて満たすときだけ実行)">
        <ol className="action-list">
          {draft.conditions.map((c, i) => (
            <li key={i} className="action-row">
              <div className="action-top">
                <select
                  className="input"
                  aria-label={`条件 ${i + 1} の種類`}
                  value={c.type}
                  onChange={(e) => {
                    const next = newCondition(e.target.value as Condition['type'], all);
                    if (next) setCondition(i, next);
                  }}
                >
                  <option value="timeRange">時間帯</option>
                  <option value="days">曜日</option>
                  <option value="sensor" disabled={!sensorDevices(all).length && c.type !== 'sensor'}>温度・湿度</option>
                  <option value="power" disabled={!powerDevices(all).length && c.type !== 'power'}>機器の ON / OFF</option>
                </select>
                <button type="button" className="btn btn-small btn-ghost btn-danger" aria-label="この条件を削除" onClick={() => set({ conditions: draft.conditions.filter((_, j) => j !== i) })}>
                  ✕
                </button>
              </div>
              <ConditionEditor devices={all} value={c} onChange={(next) => setCondition(i, next)} />
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="btn btn-small"
          disabled={draft.conditions.length >= MAX_CONDITIONS}
          onClick={() => set({ conditions: [...draft.conditions, newCondition('timeRange', all)!] })}
        >
          ＋ 条件を追加
        </button>
      </Step>

      {/* ---- なら (操作) ---- */}
      <Step tag="なら" title="操作 (上から順に実行)">
        <ol className="action-list">
          {draft.actions.map((a, i) => {
            const device = byId.get(a.deviceId);
            return (
              <li key={i} className="action-row">
                <div className="action-top">
                  <span className="action-no">{i + 1}</span>
                  <DeviceSelect
                    label={`操作 ${i + 1} の機器`}
                    devices={candidates}
                    value={a.deviceId}
                    fallbackName={a.deviceName}
                    onChange={(d) => setAction(i, { deviceId: d.id, deviceName: d.name, command: defaultCommand(d) })}
                  />
                  <div className="action-tools">
                    <button type="button" className="btn btn-small btn-ghost" aria-label="上へ" disabled={i === 0} onClick={() => moveAction(i, -1)}>↑</button>
                    <button type="button" className="btn btn-small btn-ghost" aria-label="下へ" disabled={i === draft.actions.length - 1} onClick={() => moveAction(i, 1)}>↓</button>
                    <button type="button" className="btn btn-small btn-ghost btn-danger" aria-label="この操作を削除" onClick={() => set({ actions: draft.actions.filter((_, j) => j !== i) })}>
                      ✕
                    </button>
                  </div>
                </div>
                {device && candidates.includes(device) ? (
                  <CommandPicker device={device} command={a.command} onChange={(command) => setAction(i, { ...a, command })} />
                ) : (
                  <p className="muted small">{describeCommand(a.command)}</p>
                )}
              </li>
            );
          })}
        </ol>
        <button type="button" className="btn btn-small" disabled={!candidates.length || draft.actions.length >= MAX_ACTIONS} onClick={addAction}>
          ＋ 操作を追加
        </button>
      </Step>

      <label className="field field-inline">
        <input type="checkbox" checked={draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        <span>有効にする</span>
      </label>

      {problem && <p className="muted small">{problem}</p>}
      <div className="btn-row">
        <button className="btn btn-primary" disabled={!!problem || saving} onClick={() => void submit()}>
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </section>
  );
}

function Step({ tag, title, children }: { tag: string; title: string; children: ReactNode }) {
  return (
    <fieldset className="step">
      <legend className="step-head">
        <span className={`rule-tag${tag === 'もし' ? ' rule-tag-if' : tag === 'なら' ? ' rule-tag-then' : ''}`}>{tag}</span>
        {title}
      </legend>
      <div className="step-body">{children}</div>
    </fieldset>
  );
}

function newCondition(type: Condition['type'], devices: Device[]): Condition | undefined {
  switch (type) {
    case 'timeRange':
      return { type: 'timeRange', from: '22:00', to: '06:00' };
    case 'days':
      return { type: 'days', days: [1, 2, 3, 4, 5] };
    default:
      return defaultStateCondition(type, devices);
  }
}

function ConditionEditor({ devices, value, onChange }: { devices: Device[]; value: Condition; onChange: (c: Condition) => void }) {
  switch (value.type) {
    case 'timeRange':
      return (
        <div className="field-row">
          <TimeSelect label="から" value={value.from} onChange={(from) => onChange({ ...value, from })} />
          <TimeSelect label="まで" value={value.to} onChange={(to) => onChange({ ...value, to })} />
        </div>
      );
    case 'days':
      return <DayPicker days={value.days} onChange={(days) => onChange({ ...value, days })} />;
    default:
      return <StateConditionEditor devices={devices} value={value} onChange={onChange} suffix="のとき" fixedType />;
  }
}

const TEMPERATURES = Array.from({ length: 61 }, (_, i) => 5 + i * 0.5);
const HUMIDITIES = Array.from({ length: 18 }, (_, i) => 10 + i * 5);

/** 温度・湿度、または機器の ON / OFF の条件 */
function StateConditionEditor({
  devices,
  value,
  onChange,
  suffix,
  fixedType,
}: {
  devices: Device[];
  value: StateCondition;
  onChange: (c: StateCondition) => void;
  suffix: string;
  /** 種類 (温度・湿度 / ON・OFF) の切り替えを出さない (条件の一覧で別に選ぶとき) */
  fixedType?: boolean;
}) {
  const sensors = sensorDevices(devices);
  const powers = powerDevices(devices);
  const device = devices.find((d) => d.id === value.deviceId);

  const switchType = (type: StateCondition['type']) => {
    if (type === value.type) return;
    const next = defaultStateCondition(type, devices);
    if (next) onChange(next);
  };

  return (
    <div className="state-editor">
      {!fixedType && (
        <div className="chip-row" role="radiogroup" aria-label="状態の種類">
          <button type="button" role="radio" aria-checked={value.type === 'sensor'} className={`chip${value.type === 'sensor' ? ' active' : ''}`} disabled={!sensors.length} onClick={() => switchType('sensor')}>
            温度・湿度
          </button>
          <button type="button" role="radio" aria-checked={value.type === 'power'} className={`chip${value.type === 'power' ? ' active' : ''}`} disabled={!powers.length} onClick={() => switchType('power')}>
            機器の ON / OFF
          </button>
        </div>
      )}
      {value.type === 'sensor' ? (
        <>
          <div className="field-row">
            <DeviceSelect
              label="センサー"
              devices={sensors}
              value={value.deviceId}
              fallbackName={value.deviceName}
              onChange={(d) => {
                const metric = metricsOf(d).includes(value.metric) ? value.metric : metricsOf(d)[0]!;
                onChange({ ...value, deviceId: d.id, deviceName: d.name, metric });
              }}
            />
            <select className="input" aria-label="温度か湿度か" value={value.metric} onChange={(e) => {
              const metric = e.target.value as 'temperature' | 'humidity';
              onChange({ ...value, metric, value: metric === 'temperature' ? 28 : 60 });
            }}>
              {(device ? metricsOf(device) : [value.metric]).map((m) => (
                <option key={m} value={m}>{METRIC_LABEL[m]}</option>
              ))}
            </select>
          </div>
          <div className="field-row field-row-tight">
            <select className="input" aria-label="値" value={value.value} onChange={(e) => onChange({ ...value, value: Number(e.target.value) })}>
              {withValue(value.metric === 'temperature' ? TEMPERATURES : HUMIDITIES, value.value).map((v) => (
                <option key={v} value={v}>{v}{METRIC_UNIT[value.metric]}</option>
              ))}
            </select>
            <select className="input" aria-label="以上か以下か" value={value.op} onChange={(e) => onChange({ ...value, op: e.target.value as 'above' | 'below' })}>
              <option value="above">以上</option>
              <option value="below">以下</option>
            </select>
            <span className="field-suffix">{suffix}</span>
          </div>
          {device?.state[value.metric] !== undefined && (
            <p className="muted small">いま {device.state[value.metric]}{METRIC_UNIT[value.metric]}</p>
          )}
        </>
      ) : (
        <div className="field-row">
          <DeviceSelect label="機器" devices={powers} value={value.deviceId} fallbackName={value.deviceName} onChange={(d) => onChange({ ...value, deviceId: d.id, deviceName: d.name })} />
          <div className="field-row field-row-tight">
            <select className="input" aria-label="ON か OFF か" value={value.power} onChange={(e) => onChange({ ...value, power: e.target.value as 'on' | 'off' })}>
              <option value="on">ON</option>
              <option value="off">OFF</option>
            </select>
            <span className="field-suffix">{suffix}</span>
          </div>
        </div>
      )}
    </div>
  );
}

const withValue = (list: number[], v: number) => (list.includes(v) ? list : [...list, v].sort((a, b) => a - b));

function DeviceSelect({ label, devices, value, fallbackName, onChange }: { label: string; devices: Device[]; value: string; fallbackName: string; onChange: (d: Device) => void }) {
  const found = devices.some((d) => d.id === value);
  return (
    <select
      className="input"
      aria-label={label}
      value={found ? value : ''}
      onChange={(e) => {
        const d = devices.find((x) => x.id === e.target.value);
        if (d) onChange(d);
      }}
    >
      {!found && <option value="">{fallbackName} (見つかりません)</option>}
      {devices.map((d) => (
        <option key={d.id} value={d.id}>{d.name}</option>
      ))}
    </select>
  );
}

function TimeSelect({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [h, m] = value.split(':') as [string, string];
  return (
    <div className="field">
      <span>{label}</span>
      <div className="time-select">
        <select className="input" aria-label={`${label} (時)`} value={h} onChange={(e) => onChange(`${e.target.value}:${m}`)}>
          {HOURS.map((x) => <option key={x} value={x}>{x} 時</option>)}
        </select>
        <select className="input" aria-label={`${label} (分)`} value={m} onChange={(e) => onChange(`${h}:${e.target.value}`)}>
          {MINUTES.map((x) => <option key={x} value={x}>{x} 分</option>)}
        </select>
      </div>
    </div>
  );
}

function DayPicker({ days, onChange }: { days: Weekday[]; onChange: (d: Weekday[]) => void }) {
  return (
    <div className="field">
      <div className="day-picker">
        {WEEKDAYS.map((w) => {
          const on = days.includes(w.day);
          return (
            <button
              key={w.day}
              type="button"
              aria-pressed={on}
              className={`day${on ? ' active' : ''}${w.day === 0 ? ' sun' : w.day === 6 ? ' sat' : ''}`}
              onClick={() => onChange(on ? days.filter((d) => d !== w.day) : [...days, w.day])}
            >
              {w.label}
            </button>
          );
        })}
      </div>
      <div className="day-presets">
        {DAY_PRESETS.map((p) => (
          <button key={p.label} type="button" className="link-button" onClick={() => onChange(p.days)}>{p.label}</button>
        ))}
      </div>
    </div>
  );
}

function CommandPicker({ device, command, onChange }: { device: Device; command: Command; onChange: (c: Command) => void }) {
  if (device.kind === 'aircon') return <AirconPicker device={device} command={command} onChange={onChange} />;
  return (
    <div className="chip-row" role="radiogroup" aria-label={`${device.name} の操作`}>
      {commandOptions(device).map((o) => {
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
            {modes.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
          </select>
          {temps.length > 0 ? (
            <select className="input" aria-label="温度" value={current.temperature ?? nearest(temps, 26)} onChange={(e) => update('on', mode, Number(e.target.value))}>
              {temps.map((t) => <option key={t} value={t}>{t}℃</option>)}
            </select>
          ) : (
            <span className="muted small">温度設定なし</span>
          )}
        </div>
      )}
    </div>
  );
}
