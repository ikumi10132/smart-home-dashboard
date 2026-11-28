// オートメーションの保存先 (DynamoDB)。1 件 = 1 アイテム
import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, PutCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { StoredFields } from './automation.js';
import type { Automation, AutomationInput, ScheduleRunResult } from './types.js';

const TABLE = process.env.AUTOMATION_TABLE ?? '';
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export type StoredAutomation = Automation & StoredFields;

const conditional = async (fn: () => Promise<unknown>): Promise<boolean> => {
  try {
    await fn();
    return true;
  } catch (e) {
    if (e instanceof ConditionalCheckFailedException) return false;
    throw e;
  }
};

const sortKey = (a: Automation) => (a.trigger.type === 'time' ? a.trigger.time : '~');

export async function listAutomations(): Promise<StoredAutomation[]> {
  const items: StoredAutomation[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const res = await db.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey: start }));
    items.push(...((res.Items ?? []) as StoredAutomation[]));
    start = res.LastEvaluatedKey;
  } while (start);
  return items.sort((a, b) => sortKey(a).localeCompare(sortKey(b)) || a.name.localeCompare(b.name, 'ja'));
}

export async function createAutomation(id: string, input: AutomationInput): Promise<void> {
  await db.send(
    new PutCommand({
      TableName: TABLE,
      Item: { id, ...input, updatedAt: new Date().toISOString() },
      ConditionExpression: 'attribute_not_exists(id)',
    }),
  );
}

/** 画面からの更新。前回の結果 (lastRun) は残し、状態の判定 (triggerMet) はやり直す */
export function updateAutomation(id: string, input: AutomationInput): Promise<boolean> {
  return conditional(() =>
    db.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { id },
        UpdateExpression:
          'SET #n = :n, enabled = :e, #tr = :tr, #c = :c, actions = :a, cooldownMinutes = :cd, updatedAt = :u REMOVE triggerMet',
        ConditionExpression: 'attribute_exists(id)',
        ExpressionAttributeNames: { '#n': 'name', '#tr': 'trigger', '#c': 'conditions' },
        ExpressionAttributeValues: {
          ':n': input.name,
          ':e': input.enabled,
          ':tr': input.trigger,
          ':c': input.conditions,
          ':a': input.actions,
          ':cd': input.cooldownMinutes,
          ':u': new Date().toISOString(),
        },
      }),
    ),
  );
}

export async function deleteAutomation(id: string): Promise<void> {
  await db.send(new DeleteCommand({ TableName: TABLE, Key: { id } }));
}

/** この回を実行 (判定) する権利を取る。すでに取られていれば false (Lambda が重なって動いても 1 回だけ) */
export function claimRun(id: string, key: string): Promise<boolean> {
  return conditional(() =>
    db.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { id },
        UpdateExpression: 'SET lastRunKey = :k',
        ConditionExpression: 'attribute_exists(id) AND (attribute_not_exists(lastRunKey) OR lastRunKey <> :k)',
        ExpressionAttributeValues: { ':k': key },
      }),
    ),
  );
}

/** 状態の判定結果を記録する。判定中に画面から保存されていたら書かない (保存した内容で判定し直す) */
export function saveTriggerMet(id: string, updatedAt: string, met: boolean): Promise<boolean> {
  return conditional(() =>
    db.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { id },
        UpdateExpression: 'SET triggerMet = :m',
        ConditionExpression: 'updatedAt = :u',
        ExpressionAttributeValues: { ':m': met, ':u': updatedAt },
      }),
    ),
  );
}

export async function saveRunResult(id: string, result: ScheduleRunResult): Promise<void> {
  // 実行中に削除されたものは作り直さない
  await conditional(() =>
    db.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { id },
        UpdateExpression: 'SET lastRun = :r',
        ConditionExpression: 'attribute_exists(id)',
        ExpressionAttributeValues: { ':r': result },
      }),
    ),
  );
}
