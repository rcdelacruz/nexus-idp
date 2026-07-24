/**
 * Local, offline-usable registry of provisioned resources.
 *
 * Persisted to ~/.backstage-agent/resources.json so the agent (and the `resources` / `resource`
 * CLI commands) can list and manage locally-provisioned resources with no internet — the portal
 * UI is cloud-hosted and unreachable offline, so this file is the source of truth for local ops.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LocalResource } from '../types';
import logger from '../utils/logger';

export class LocalResourceRegistry {
  private readonly filePath: string;

  constructor() {
    const dir = path.join(os.homedir(), '.backstage-agent');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.filePath = path.join(dir, 'resources.json');
  }

  list(): LocalResource[] {
    try {
      if (!fs.existsSync(this.filePath)) return [];
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error: any) {
      logger.warn(`Failed to read local resource registry: ${error.message}`);
      return [];
    }
  }

  get(resourceName: string): LocalResource | undefined {
    return this.list().find(r => r.resourceName === resourceName);
  }

  private write(resources: LocalResource[]): void {
    fs.writeFileSync(this.filePath, JSON.stringify(resources, null, 2), 'utf-8');
  }

  /** Insert or update a resource (keyed by resourceName). */
  upsert(resource: LocalResource): void {
    const resources = this.list().filter(r => r.resourceName !== resource.resourceName);
    resources.push(resource);
    this.write(resources);
  }

  /** Update the state (and optionally timestamp) of an existing resource. */
  setState(resourceName: string, state: LocalResource['state']): void {
    const resources = this.list();
    const r = resources.find(x => x.resourceName === resourceName);
    if (!r) return;
    r.state = state;
    r.updatedAt = new Date().toISOString();
    this.write(resources);
  }

  remove(resourceName: string): void {
    this.write(this.list().filter(r => r.resourceName !== resourceName));
  }
}
