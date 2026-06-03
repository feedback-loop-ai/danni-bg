import type { Database } from 'bun:sqlite';
import { nowIso } from '../../lib/time.ts';

export type NotificationKind = 'run_failed' | 'threshold_exceeded';

export interface NotificationRow {
  id: number;
  run_id: string;
  kind: NotificationKind;
  channel: string;
  delivered_at: string;
  payload_json: string;
}

export interface InsertNotificationInput {
  runId: string;
  kind: NotificationKind;
  channel: string;
  payload: Record<string, unknown>;
  deliveredAt?: string;
}

export class NotificationsRepo {
  constructor(private readonly db: Database) {}

  insert(input: InsertNotificationInput): void {
    const deliveredAt = input.deliveredAt ?? nowIso();
    this.db
      .query(
        `INSERT INTO notifications (run_id, kind, channel, delivered_at, payload_json) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(input.runId, input.kind, input.channel, deliveredAt, JSON.stringify(input.payload));
  }

  listByRun(runId: string): NotificationRow[] {
    return this.db
      .query<NotificationRow, [string]>(
        'SELECT * FROM notifications WHERE run_id = ? ORDER BY delivered_at',
      )
      .all(runId);
  }
}
