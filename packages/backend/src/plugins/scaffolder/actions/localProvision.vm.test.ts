import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { mockServices } from '@backstage/backend-test-utils';
import { createLocalProvisionAction } from './localProvision';

describe('stratpoint:local-provision — VM labs', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('sends the VM spec with the seed files and no compose file', async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-vm-'));
    fs.ensureDirSync(path.join(ws, 'rendered/seed'));
    fs.writeFileSync(path.join(ws, 'rendered/seed/run-seed.sh'), 'echo seed');
    fs.writeFileSync(path.join(ws, 'rendered/seed/report.py'), 'print(1)');
    const calls: any[] = [];
    global.fetch = jest.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/agent')) {
        return new Response(JSON.stringify({ agents: [{ agent_id: 'a1', is_connected: true }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ task_id: 't1', task: { task_id: 't1' } }), { status: 201 });
    }) as any;
    const action = createLocalProvisionAction({
      discovery: { getBaseUrl: async () => 'http://b/api/local-provisioner', getExternalBaseUrl: async () => 'http://portal' } as any,
      auth: { getPluginRequestToken: async () => ({ token: 'obo' }) } as any,
      config: mockServices.rootConfig({ data: { organization: { domain: 'example.com' }, app: { baseUrl: 'http://portal' } } }),
    });
    await action.handler({
      input: {
        taskType: 'provision-training',
        resourceName: 'linux-capstone-x',
        vm: { image: '24.04', cpus: 2, memoryGb: 4, diskGb: 40, sshUser: 'trainee', seedDir: './rendered/seed', seedCommand: ['bash', '/tmp/lab-seed/run-seed.sh'], seedEnv: { SEED_TOKEN: 't' } },
        config: { labId: 'linux-capstone' },
      },
      workspacePath: ws,
      logger: mockServices.logger.mock(),
      output: () => {},
      user: { entity: { spec: { profile: { email: 'jane@example.com' } } }, ref: 'user:default/jane' },
      getInitiatorCredentials: async () => ({}),
    } as any);
    const post = calls.find(c => c.url.endsWith('/tasks'));
    const body = JSON.parse(post.init.body);
    expect(body.config.executor).toBe('multipass');
    expect(body.config.dockerCompose).toBeUndefined();
    expect(body.config.vm).toMatchObject({ image: '24.04', cpus: 2, memoryGb: 4, diskGb: 40, sshUser: 'trainee', seedEnv: { SEED_TOKEN: 't' } });
    expect(body.config.vm.seedDir).toBeUndefined();
    expect(Object.keys(body.config.vm.seedFiles).sort()).toEqual(['report.py', 'run-seed.sh']);
    expect(Buffer.from(body.config.vm.seedFiles['run-seed.sh'], 'base64').toString()).toBe('echo seed');
  });
});
