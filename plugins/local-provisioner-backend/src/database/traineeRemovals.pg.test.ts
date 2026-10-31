import knexFactory, { Knex } from 'knex';
import fs from 'fs';
import path from 'path';
import { TaskStore } from './TaskStore';
import { TaskStatus } from '../types';

/**
 * Real-Postgres check of migration 008 + the Trainees-view removal queries (migrations 001–005 are
 * Postgres-only, so this can't run on SQLite). Skipped unless LP_TEST_PG_URL points at a throwaway
 * database, e.g.:
 *   docker run -d --rm --name lp-pg -e POSTGRES_PASSWORD=pw -p 55432:5432 postgres:17-alpine
 *   LP_TEST_PG_URL=postgres://postgres:pw@localhost:55432/postgres CI=true yarn backstage-cli package test traineeRemovals
 */
const url = process.env.LP_TEST_PG_URL;
const maybe = url ? describe : describe.skip;

maybe('trainee removals on real Postgres', () => {
  let db: Knex;
  const dir = path.join(__dirname, 'migrations');
  const migrations = fs.readdirSync(dir).filter(f => /^\d{3}-.*\.js$/.test(f)).sort();

  beforeAll(async () => {
    db = knexFactory({ client: 'pg', connection: url });
    await db.raw('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    for (const f of migrations) await require(path.join(dir, f)).up(db);
  });
  afterAll(async () => {
    await db?.destroy();
  });

  it('applies every migration including 008', () => {
    expect(migrations[migrations.length - 1]).toBe('008-create-trainee-removals.js');
  });

  it('hides exactly the removed lab and keeps the audit record', async () => {
    const store = new TaskStore(db);
    for (const name of ['lab-a', 'lab-b']) {
      const t = await store.createTask('ann@example.com', {
        agent_id: 'agent-1',
        task_type: 'provision-training' as any,
        resource_name: name,
        config: { labId: 'ministack', dockerCompose: 'services: {}', githubRepoUrl: `https://github.com/o/training-${name}` },
      });
      await db('provisioning_tasks').where({ task_id: t.task_id }).update({ status: TaskStatus.COMPLETED, completed_at: new Date() });
    }
    expect((await store.getTrainingResourceHistories()).map(h => h.resource.resource_name).sort()).toEqual(['lab-a', 'lab-b']);

    await store.recordTraineeRemoval({
      agentId: 'agent-1',
      resourceName: 'lab-a',
      traineeEmail: 'ann@example.com',
      repoUrl: 'https://github.com/o/training-lab-a',
      repoDeleted: true,
      removedBy: 'teacher@example.com',
    });
    // A capstone-only removal (no lab) must not hide anything.
    await store.recordTraineeRemoval({ enrollmentId: 'e1', traineeEmail: 'bob@example.com', repoDeleted: false, removedBy: 't' });

    expect([...(await store.removedTraineeLabs())]).toEqual(['agent-1::lab-a']);
    const rows = await db('trainee_removals').orderBy('removed_at');
    expect(rows[0]).toMatchObject({ agent_id: 'agent-1', resource_name: 'lab-a', repo_deleted: true, removed_by: 'teacher@example.com' });
    expect(rows[1]).toMatchObject({ agent_id: null, enrollment_id: 'e1', repo_deleted: false });
    // The lab's own task history is untouched.
    expect(await db('provisioning_tasks').where({ resource_name: 'lab-a' }).count('* as n')).toEqual([{ n: '1' }]);
  });

  it('rolls 008 back cleanly', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    await require(path.join(dir, '008-create-trainee-removals.js')).down(db);
    expect(await db.schema.hasTable('trainee_removals')).toBe(false);
  });
});
