import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { mockServices } from '@backstage/backend-test-utils';
import { createLocalProvisionAction } from './localProvision';

/**
 * The lab templates link their output to `steps['queue-task'].output.taskUrl`, and the Create run
 * page follows that link to the lab's drawer when a run succeeds (CustomTaskPage, in packages/app,
 * reads it with parseLabTaskPath from the local-provisioner plugin). So the action's output is a
 * contract: `/local-provisioner/tasks/<task id>`, a path inside the portal, task id as returned by
 * the queue.
 */
describe('stratpoint:local-provision — outputs', () => {
  const realFetch = global.fetch;
  let ws: string | undefined;
  afterEach(() => {
    global.fetch = realFetch;
    if (ws) fs.removeSync(ws);
    ws = undefined;
  });

  it('outputs taskUrl as the portal path of the queued task, so the run page can open its lab', async () => {
    const taskId = randomUUID();
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-out-'));
    fs.writeFileSync(path.join(ws, 'docker-compose.yml'), 'services:\n  app:\n    image: busybox\n');
    global.fetch = jest.fn(async (url: any) => {
      if (String(url).endsWith('/agent?verify=1')) {
        return new Response(JSON.stringify({ agents: [{ agent_id: 'a1', is_connected: true }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ task_id: taskId, task: { task_id: taskId } }), { status: 201 });
    }) as any;
    const action = createLocalProvisionAction({
      discovery: { getBaseUrl: async () => 'http://b/api/local-provisioner', getExternalBaseUrl: async () => 'http://portal' } as any,
      auth: { getPluginRequestToken: async () => ({ token: 'obo' }) } as any,
      config: mockServices.rootConfig({ data: { organization: { domain: 'example.com' }, app: { baseUrl: 'http://portal' } } }),
    });
    const out: Record<string, unknown> = {};
    await action.handler({
      input: { taskType: 'provision-training', resourceName: 'linux-capstone-a-jane-1', dockerComposeFile: './docker-compose.yml', config: { labId: 'linux-capstone-a' } },
      workspacePath: ws,
      logger: mockServices.logger.mock(),
      output: (key: string, value: unknown) => {
        out[key] = value;
      },
      user: { entity: { spec: { profile: { email: 'jane@example.com' } } }, ref: 'user:default/jane' },
      getInitiatorCredentials: async () => ({}),
    } as any);

    expect(out.taskId).toBe(taskId);
    expect(out.taskUrl).toBe(`/local-provisioner/tasks/${taskId}`);
    // A path inside the portal, never an absolute URL (the run page follows only relative lab paths).
    expect(String(out.taskUrl)).toMatch(/^\/local-provisioner\/tasks\/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  });
});
