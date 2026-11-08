import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * The real Agent, a throwaway home folder, and lifecycle tasks whose targetTaskId is a path. Audit 2026-11-07: the id was joined into a
 * path and a teardown removed that folder recursively, so a task could make the agent delete any folder under the user's home.
 */
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-safety-'));
const previousHome = process.env.HOME;
const previousProfile = process.env.USERPROFILE;
process.env.HOME = home;
process.env.USERPROFILE = home;
test.after(() => {
  process.env.HOME = previousHome;
  process.env.USERPROFILE = previousProfile;
  fs.rmSync(home, { recursive: true, force: true });
});

// Loaded after HOME is set: the config folder is derived from it when the Agent is constructed.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Agent } = require('./Agent') as typeof import('./Agent');

const task = (type: string, targetTaskId: string) => ({ task_id: 't', task_type: type, resource_name: 'x', config: { targetTaskId } }) as any;

for (const type of ['deprovision', 'stop', 'start', 'restart', 'run-check']) {
  test(`${type} with a targetTaskId that is a path is refused and nothing is touched`, async () => {
    const agent = new Agent('http://portal.invalid', 'agent-x', 'tok') as any;
    const project = path.join(home, 'projects', 'myapp');
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(project, 'docker-compose.yml'), 'services: {db: {image: postgres}}');
    fs.writeFileSync(path.join(project, 'src.txt'), 'real project source');
    fs.mkdirSync(path.join(home, 'Documents'), { recursive: true });
    fs.writeFileSync(path.join(home, 'Documents', 'thesis.txt'), 'precious');

    for (const evil of ['../../projects/myapp', '../..', '..', '/etc', 'a/../../..']) {
      const cfg = { targetTaskId: evil, service: 'x', argv: ['true'] };
      const result = await agent.dispatch(type, { ...task(type, evil), config: cfg }, cfg);
      assert.equal(result.success, false, `${type} ${evil}`);
      assert.match(result.error, /not a task id/);
    }
    assert.equal(fs.existsSync(path.join(project, 'src.txt')), true, 'project folder removed');
    assert.equal(fs.existsSync(path.join(home, 'Documents', 'thesis.txt')), true, 'home folder content removed');
    assert.equal(fs.existsSync(home), true);
  });
}

test('a missing targetTaskId is still reported as missing', async () => {
  const agent = new Agent('http://portal.invalid', 'agent-x', 'tok') as any;
  const result = await agent.dispatch('deprovision', { task_id: 't', task_type: 'deprovision', resource_name: 'x', config: {} }, {});
  assert.equal(result.success, false);
  assert.match(result.error, /requires config.targetTaskId/);
});
