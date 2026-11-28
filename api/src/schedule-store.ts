// スケジュールの保存先 (DynamoDB)。1 件 = 1 アイテム
import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, PutCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { Schedule, ScheduleInput, ScheduleRunResult } from './types.js';

const TABLE = process.env.SCHEDULE_TABLE ?? '';
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export interface StoredSchedule extends Schedule {
  /** 最後に実行した回 ("2026-11-28T07:00")。二重実行を防ぐ */
  lastRunKey?: string;
}

export async function listSchedules(): Promise<StoredSchedule[]> {
  const items: StoredSchedule[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const res = await db.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey: start }));
    items.push(...((res.Items ?? []) as StoredSchedule[]));
    start = res.LastEvaluatedKey;
  } while (start);
  return items.sort((a, b) => a.time.localeCompare(b.time) || a.name.localeCompare(b.name, 'ja'));
}

export async function createSchedule(id: string, input: ScheduleInput): Promise<void> {
  await db.send(
    new PutCommand({
      TableName: TABLE,
      Item: { id, ...input, updatedAt: new Date().toISOString() },
      ConditionExpression: 'attribute_not_exists(id)',
    }),
  );
}

/** 画面からの更新。実行の記録 (lastRun / lastRunKey) は残す */
export async function updateSchedule(id: string, input: ScheduleInput): Promise<boolean> {
  try {
    await db.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { id },
        UpdateExpression: 'SET #n = :n, enabled = :e, days = :d, #t = :t, actions = :a, updatedAt = :u',
        ConditionExpression: 'attribute_exists(id)',
        ExpressionAttributeNames: { '#n': 'name', '#t': 'time' },
        ExpressionAttributeValues: {
          ':n': input.name,
          ':e': input.enabled,
          ':d': input.days,
          ':t': input.time,
          ':a': input.actions,
          ':u': new Date().toISOString(),
        },
      }),
    );
    return true;
  } catch (e) {
    if (e instanceof ConditionalCheckFailedException) return false;
    throw e;
  }
}

export async function deleteSchedule(id: string): Promise<void> {
  await db.send(new DeleteCommand({ TableName: TABLE, Key: { id } }));
}

/** この回を実行する権利を取る。すでに誰かが取っていれば false (Lambda が重なって動いても 1 回だけ実行する) */
export async function claimRun(id: string, key: string): Promise<boolean> {
  try {
    await db.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { id },
        UpdateExpression: 'SET lastRunKey = :k',
        ConditionExpression: 'attribute_exists(id) AND (attribute_not_exists(lastRunKey) OR lastRunKey <> :k)',
        ExpressionAttributeValues: { ':k': key },
      }),
    );
    return true;
  } catch (e) {
    if (e instanceof ConditionalCheckFailedException) return false;
    throw e;
  }
}

export async function saveRunResult(id: string, result: ScheduleRunResult): Promise<void> {
  try {
    await db.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { id },
        UpdateExpression: 'SET lastRun = :r',
        ConditionExpression: 'attribute_exists(id)', // 実行中に削除されたものは作り直さない
        ExpressionAttributeValues: { ':r': result },
      }),
    );
  } catch (e) {
    if (!(e instanceof ConditionalCheckFailedException)) throw e;
  }
}
