/**
 * Offline outbox for status updates.
 *
 * When the portal is unreachable (intermittent/no internet), status updates are queued to
 * ~/.backstage-agent/outbox.json instead of being lost, and flushed when connectivity returns.
 * A provision that completes offline still reports — and the catalog/UI catch up — once online.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import logger from '../utils/logger';

export interface OutboxEntry {
  taskId: string;
  body: Record<string, any>;
  queuedAt: string;
}

export class OutboxQueue {
  private readonly filePath: string;

  constructor() {
    const dir = path.join(os.homedir(), '.backstage-agent');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.filePath = path.join(dir, 'outbox.json');
  }

  private read(): OutboxEntry[] {
    try {
      if (!fs.existsSync(this.filePath)) return [];
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private write(entries: OutboxEntry[]): void {
    fs.writeFileSync(this.filePath, JSON.stringify(entries, null, 2), 'utf-8');
  }

  enqueue(taskId: string, body: Record<string, any>): void {
    const entries = this.read();
    entries.push({ taskId, body, queuedAt: new Date().toISOString() });
    this.write(entries);
    logger.info(`Queued status update for task ${taskId} (offline outbox: ${entries.length})`);
  }

  size(): number {
    return this.read().length;
  }

  /**
   * Attempt to deliver every queued entry via `send`. Entries that deliver are removed; on the
   * first failure we stop and keep the rest (still offline) for the next flush.
   */
  async flush(send: (taskId: string, body: Record<string, any>) => Promise<boolean>): Promise<void> {
    let entries = this.read();
    if (entries.length === 0) return;

    logger.info(`Flushing ${entries.length} queued status update(s)...`);
    const remaining: OutboxEntry[] = [];
    let stillOffline = false;

    for (const entry of entries) {
      if (stillOffline) {
        remaining.push(entry);
        continue;
      }
      try {
        const ok = await send(entry.taskId, entry.body);
        if (!ok) {
          stillOffline = true;
          remaining.push(entry);
        }
      } catch {
        stillOffline = true;
        remaining.push(entry);
      }
    }

    this.write(remaining);
    if (remaining.length === 0) logger.info('Outbox flushed.');
    else logger.warn(`Outbox flush incomplete; ${remaining.length} update(s) still queued.`);
  }
}
