/**
 * HTTP-level tests for the generic provision-training type through the real task router:
 * POST /tasks validation (400s, ordering vs. the offline-agent 409) and the docs link on GET.
 * TaskQueueService / AgentService are stubbed — no database.
 */

import express from 'express';
import request from 'supertest';
import { mockServices } from '@backstage/backend-test-utils';
import { createTaskRoutes, hideCheckInternals } from './taskRoutes';
import { ProvisioningTask, TaskStatus, TaskType } from '../types';

const COMPOSE = 'services:\n  app:\n    image: busybox\n';

/** The signed-in user of every test below (`req.user.email`); an agent belongs to someone, and POST /tasks checks it is the caller. */
const ME = 'jane.doe@example.com';

function setup(
  opts: {
    online?: boolean;
    confirmed?: boolean;
    tasks?: Partial<ProvisioningTask>[];
    /** Who owns the agent the request names. `null` = no such agent row. Default: the caller. */
    agentOwner?: string | null;
    agentVersion?: string;
  } = {},
) {
  const created: any[] = [];
  const taskQueue = {
    createTask: jest.fn(async (userId: string, req: any) => {
      const task = { task_id: 't-new', user_id: userId, status: TaskStatus.PENDING, ...req };
      created.push(task);
      return task;
    }),
    getTasksForUser: jest.fn(async () => (opts.tasks ?? []) as ProvisioningTask[]),
    getTask: jest.fn(async (id: string) => (opts.tasks ?? []).find(t => t.task_id === id) as ProvisioningTask | undefined),
    getAllTasks: jest.fn(async () => (opts.tasks ?? []) as ProvisioningTask[]),
    getResourceState: jest.fn(async () => undefined),
  };
  const agentService = {
    isAgentOnline: jest.fn(async () => opts.online ?? true),
    // The guard needs proof the agent answers now, not just a recent last_seen.
    confirmAgentOnline: jest.fn(async () => opts.confirmed ?? opts.online ?? true),
    notifyAgent: jest.fn(),
    getAgentById: jest.fn(async (id: string) =>
      opts.agentOwner === null ? null : { agent_id: id, user_id: opts.agentOwner === undefined ? ME : opts.agentOwner, agent_version: opts.agentVersion ?? '0.1.30' },
    ),
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { email: ME };
    next();
  });
  app.use(
    '/tasks',
    createTaskRoutes(taskQueue as any, mockServices.logger.mock(), agentService as any, {
      ministack: '/engineering-docs?source=ministack-lab&path=index',
    }),
  );
  return { app, taskQueue, agentService, created };
}

const body = (config: Record<string, unknown>, task_type: string = TaskType.PROVISION_TRAINING) => ({
  agent_id: 'agent-1',
  task_type,
  resource_name: 'ministack-jane-1',
  config,
});

describe('POST /tasks — provision-training', () => {
  it('queues a valid generic lab (201) and notifies the agent', async () => {
    const { app, taskQueue, agentService } = setup();
    const res = await request(app).post('/tasks').send(body({ labId: 'ministack', dockerCompose: COMPOSE }));
    expect(res.status).toBe(201);
    expect(taskQueue.createTask).toHaveBeenCalledTimes(1);
    expect(agentService.notifyAgent).toHaveBeenCalledWith('agent-1');
  });

  it.each([
    ['missing labId', { dockerCompose: COMPOSE }, /labId/],
    ['tag-invalid labId', { labId: 'a--b', dockerCompose: COMPOSE }, /labId/],
    ['reserved legacy labId', { labId: 'kafka', dockerCompose: COMPOSE }, /labId/],
    ['missing dockerCompose (agent would start Kafka)', { labId: 'ministack' }, /dockerCompose/],
  ])('rejects %s with 400 and queues nothing', async (_label, config, message) => {
    const { app, taskQueue } = setup();
    const res = await request(app).post('/tasks').send(body(config));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(message);
    expect(taskQueue.createTask).not.toHaveBeenCalled();
  });

  it('accepts a slug that is also an Object.prototype key (the docs lookup is what must not break — see GET)', async () => {
    const { app } = setup();
    const res = await request(app).post('/tasks').send(body({ labId: 'constructor', dockerCompose: COMPOSE }));
    expect(res.status).toBe(201);
  });

  it('returns the 400 even when the agent is offline (validation runs before the 409)', async () => {
    const { app, agentService } = setup({ online: false });
    const res = await request(app).post('/tasks').send(body({ labId: 'ministack' }));
    expect(res.status).toBe(400);
    expect(agentService.isAgentOnline).not.toHaveBeenCalled();
  });

  it('a valid lab to an offline agent still gets the existing 409', async () => {
    const { app } = setup({ online: false });
    const res = await request(app).post('/tasks').send(body({ labId: 'ministack', dockerCompose: COMPOSE }));
    expect(res.status).toBe(409);
  });

  it('refuses to queue to an agent that looks online but does not answer (the guardrail must not trust last_seen)', async () => {
    const { app, taskQueue, agentService } = setup({ online: true, confirmed: false });
    const res = await request(app).post('/tasks').send(body({ labId: 'ministack', dockerCompose: COMPOSE }));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Agent offline');
    expect(agentService.confirmAgentOnline).toHaveBeenCalled();
    expect(taskQueue.createTask).not.toHaveBeenCalled();
  });

  it('leaves legacy training types unvalidated (existing templates unchanged)', async () => {
    const { app } = setup();
    const res = await request(app).post('/tasks').send(body({}, TaskType.PROVISION_KAFKA_TRAINING));
    expect(res.status).toBe(201);
  });
});

describe('GET /tasks — docs link for generic labs', () => {
  const row = (task_type: string, config: Record<string, unknown>): Partial<ProvisioningTask> => ({
    task_id: `t-${task_type}-${String(config.labId)}`,
    agent_id: 'agent-1',
    user_id: 'jane.doe@example.com',
    task_type,
    resource_name: 'r',
    config,
    status: TaskStatus.COMPLETED,
  });

  it('attaches docs_url by labId, and never for prototype keys or lifecycle rows', async () => {
    const { app } = setup({
      tasks: [
        row(TaskType.PROVISION_TRAINING, { labId: 'ministack' }),
        row(TaskType.PROVISION_TRAINING, { labId: 'constructor' }),
        row(TaskType.STOP, { labId: 'ministack', targetTaskId: 'x' }),
      ],
    });
    const res = await request(app).get('/tasks');
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.tasks.map((t: any) => [t.task_id, t.docs_url]));
    expect(byId['t-provision-training-ministack']).toBe('/engineering-docs?source=ministack-lab&path=index');
    expect(byId['t-provision-training-constructor']).toBeUndefined();
    expect(byId['t-stop-ministack']).toBeUndefined();
  });
});

describe('the Trainees view routes', () => {
  const build = (traineeActivity?: any) => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).user = { email: 'instructor@example.com' };
      next();
    });
    const taskQueue = { getTask: jest.fn(async () => null) };
    app.use('/tasks', createTaskRoutes(taskQueue as any, mockServices.logger.mock(), undefined, {}, traineeActivity));
    return { app, taskQueue };
  };

  it('GET /list is served by the trainees handler, not shadowed by /:taskId', async () => {
    const listTrainees = jest.fn(async () => [{ resourceName: 'lab-a' }]);
    const { app, taskQueue } = build({ listTrainees });
    const res = await request(app).get('/tasks/admin/trainees/list');
    expect(res.status).toBe(200);
    expect(res.body.trainees).toEqual([{ resourceName: 'lab-a' }]);
    expect(listTrainees).toHaveBeenCalledWith();
    expect(taskQueue.getTask).not.toHaveBeenCalled();
  });

  it('the old list path is gone (an old open page gets an error, not a changed response)', async () => {
    const { app } = build({ listTrainees: jest.fn(async () => []) });
    expect((await request(app).get('/tasks/admin/trainees')).status).toBe(404);
  });

  it('answers 501 when the service is not wired', async () => {
    const app = build().app;
    expect((await request(app).get('/tasks/admin/trainees/list')).status).toBe(501);
    expect((await request(app).get('/tasks/admin/trainees/detail?key=lab:a::b')).status).toBe(501);
    expect((await request(app).post('/tasks/admin/trainees/activity').send({ keys: ['lab:a::b'] })).status).toBe(501);
  });

  describe('POST /activity', () => {
    const post = (app: express.Express, payload: unknown) => request(app).post('/tasks/admin/trainees/activity').send(payload as any);

    it('passes the keys, the level and refresh to the service and answers the items, never cached', async () => {
      const activity = jest.fn(async () => [{ key: 'lab:a::b', code: 'ok' }]);
      const { app, taskQueue } = build({ activity });
      const res = await post(app, { keys: ['lab:a::b', 'cap:1'], level: 'full', refresh: true });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ activity: [{ key: 'lab:a::b', code: 'ok' }] });
      expect(res.headers['cache-control']).toBe('no-store');
      expect(activity).toHaveBeenCalledWith(['lab:a::b', 'cap:1'], 'full', true);
      expect(taskQueue.getTask).not.toHaveBeenCalled();
    });

    it('defaults to the brief level and no refresh; refresh must be exactly true', async () => {
      const activity = jest.fn(async () => []);
      const { app } = build({ activity });
      await post(app, { keys: ['lab:a::b'] });
      await post(app, { keys: ['lab:a::b'], refresh: 'true' });
      expect(activity).toHaveBeenNthCalledWith(1, ['lab:a::b'], 'brief', false);
      expect(activity).toHaveBeenNthCalledWith(2, ['lab:a::b'], 'brief', false);
    });

    it.each([
      ['no body', undefined],
      ['no keys', {}],
      ['keys that is not a list', { keys: 'lab:a::b' }],
      ['an empty list', { keys: [] }],
      ['51 keys', { keys: Array.from({ length: 51 }, (_, i) => `lab:a::${i}`) }],
      ['a key that is not text', { keys: ['lab:a::b', 5] }],
      ['a null key', { keys: [null] }],
      ['an object as key', { keys: [{ key: 'x' }] }],
      ['an empty key', { keys: [''] }],
      ['a key over 400 characters', { keys: [`lab:a::${'x'.repeat(400)}`] }],
      ['an unknown level', { keys: ['lab:a::b'], level: 'everything' }],
      ['six keys at the full level', { keys: Array.from({ length: 6 }, (_, i) => `lab:a::${i}`), level: 'full' }],
    ])('refuses %s with 400 and calls nothing', async (_name, payload) => {
      const activity = jest.fn(async () => []);
      const { app } = build({ activity });
      const res = await post(app, payload);
      expect(res.status).toBe(400);
      expect(activity).not.toHaveBeenCalled();
    });

    it('accepts exactly 50 keys at the brief level and 5 at the full level', async () => {
      const activity = jest.fn(async () => []);
      const { app } = build({ activity });
      expect((await post(app, { keys: Array.from({ length: 50 }, (_, i) => `lab:a::${i}`) })).status).toBe(200);
      expect((await post(app, { keys: Array.from({ length: 5 }, (_, i) => `lab:a::${i}`), level: 'full' })).status).toBe(200);
    });

    it('answers 500 when the service fails', async () => {
      const { app } = build({ activity: jest.fn(async () => { throw new Error('boom'); }) });
      expect((await post(app, { keys: ['lab:a::b'] })).status).toBe(500);
    });
  });

  describe('GET /detail', () => {
    it('answers the trainee, never cached', async () => {
      const detail = jest.fn(async () => ({ key: 'lab:a::b', events: [] }));
      const { app } = build({ detail });
      const res = await request(app).get('/tasks/admin/trainees/detail').query({ key: 'lab:a::b' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ trainee: { key: 'lab:a::b', events: [] } });
      expect(res.headers['cache-control']).toBe('no-store');
      expect(detail).toHaveBeenCalledWith('lab:a::b');
    });

    it('answers 404 for a key the service does not know', async () => {
      const { app } = build({ detail: jest.fn(async () => undefined) });
      expect((await request(app).get('/tasks/admin/trainees/detail').query({ key: 'lab:a::b' })).status).toBe(404);
    });

    it.each([['no key', ''], ['an empty key', '?key='], ['a key over 400 characters', `?key=${'x'.repeat(401)}`], ['two keys', '?key=a&key=b']])(
      'refuses %s with 400 and calls nothing',
      async (_name, query) => {
        const detail = jest.fn(async () => ({}));
        const { app } = build({ detail });
        expect((await request(app).get(`/tasks/admin/trainees/detail${query}`)).status).toBe(400);
        expect(detail).not.toHaveBeenCalled();
      },
    );

    it('answers 500 when the service fails', async () => {
      const { app } = build({ detail: jest.fn(async () => { throw new Error('boom'); }) });
      expect((await request(app).get('/tasks/admin/trainees/detail').query({ key: 'lab:a::b' })).status).toBe(500);
    });
  });
});

describe('POST /tasks — instructor checks', () => {
  it('refuses run-check from a user (only the instructor endpoint queues checks)', async () => {
    const { app } = setup({ online: true });
    const res = await request(app)
      .post('/tasks')
      .send({ agent_id: 'agent-1', task_type: 'run-check', resource_name: 'lab', config: { targetTaskId: 't', service: 'x', argv: ['sh', '-c', 'id'] } });
    expect(res.status).toBe(403);
  });
});

describe('validAgentVersion', () => {
  it('accepts only plain x.y.z', () => {
    const { validAgentVersion } = require('./agentRoutes');
    expect(validAgentVersion('0.1.23')).toBe('0.1.23');
    for (const bad of [undefined, '', '0.1', 'v0.1.23', '0.1.23-beta', '0.1.23; drop table', ['0.1.23'], 123]) {
      expect(validAgentVersion(bad)).toBeUndefined();
    }
  });
});

describe('parseCapabilities', () => {
  it('keeps only well-formed values from the poll query', () => {
    const { parseCapabilities } = require('./agentRoutes');
    expect(parseCapabilities({ arch: 'arm64', cpus: '10', dockerMem: '8217542656', dockerOs: 'linux' })).toEqual({
      arch: 'arm64',
      cpus: 10,
      dockerMemoryBytes: 8217542656,
      dockerOs: 'linux',
    });
    expect(parseCapabilities({ arch: 'x64;rm', cpus: '-1', dockerMem: '1e9', dockerOs: 'plan9' })).toBeUndefined();
    expect(parseCapabilities({})).toBeUndefined();
    expect(parseCapabilities({ arch: 'x64', dockerMem: String(2 ** 50) })).toEqual({ arch: 'x64' });
  });
});

describe('POST /tasks — VM labs (Multipass)', () => {
  const vmTask = {
    agent_id: 'agent-1',
    task_type: 'provision-training',
    resource_name: 'linux-capstone-x',
    config: { labId: 'linux-capstone', executor: 'multipass', vm: { image: '24.04' } },
  };
  const build = (agentVersion: string | undefined) => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).user = { email: 'jane.doe@example.com' };
      next();
    });
    const taskQueue = { createTask: jest.fn(async (_u: string, r: any) => ({ task_id: 't-vm', ...r })) };
    const agentService = { isAgentOnline: async () => true, confirmAgentOnline: async () => true, notifyAgent: jest.fn(), getAgentById: async () => ({ agent_version: agentVersion, user_id: ME }) };
    app.use('/tasks', createTaskRoutes(taskQueue as any, mockServices.logger.mock(), agentService as any, {}));
    return { app, taskQueue };
  };

  it('queues a VM lab for an agent that supports it (no compose file needed)', async () => {
    const { app, taskQueue } = build('0.1.23');
    expect((await request(app).post('/tasks').send(vmTask)).status).toBe(201);
    expect(taskQueue.createTask).toHaveBeenCalled();
  });

  it('refuses a VM lab for an older agent (it would provision its bundled Docker template instead)', async () => {
    const { app, taskQueue } = build('0.1.22');
    const res = await request(app).post('/tasks').send(vmTask);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/backstage-agent update/);
    expect(taskQueue.createTask).not.toHaveBeenCalled();
  });

  it('queues a lab that mounts the trainee repo only for agents that clone it first (0.1.29+)', async () => {
    const nodeLab = {
      agent_id: 'agent-1',
      task_type: 'provision-training',
      resource_name: 'nodejs-capstone-x',
      config: { labId: 'nodejs-capstone', dockerCompose: 'services: {}', workspaceMount: true, githubRepoUrl: 'https://github.com/o/nodejs-capstone-x' },
    };
    const old = build('0.1.28');
    const refused = await request(old.app).post('/tasks').send(nodeLab);
    expect(refused.status).toBe(409);
    expect(refused.body.message).toMatch(/needs backstage-agent 0\.1\.29\+ \(yours: 0\.1\.28\)/);
    expect(old.taskQueue.createTask).not.toHaveBeenCalled();
    const ok = build('0.1.29');
    expect((await request(ok.app).post('/tasks').send(nodeLab)).status).toBe(201);
  });

  it('still requires a VM spec for a multipass lab', async () => {
    const { app } = build('0.1.23');
    const res = await request(app).post('/tasks').send({ ...vmTask, config: { labId: 'linux-capstone', executor: 'multipass' } });
    expect(res.status).toBe(400);
  });
});

describe('GET /tasks/:taskId/retry-conflicts', () => {
  const compose = (...ports: string[]) => `services:\n  m:\n    image: busybox\n    ports:\n${ports.map(p => `      - "${p}"`).join('\n')}\n`;
  const failed = {
    task_id: 'failed-1',
    agent_id: 'agent-1',
    user_id: 'jane.doe@example.com',
    task_type: TaskType.PROVISION_TRAINING,
    resource_name: 'terraform-capstone-a-jane',
    status: TaskStatus.FAILED,
    config: { labId: 'terraform-capstone-a', dockerCompose: compose('127.0.0.1:4566:4566') },
  };
  const oldLab = {
    resource: { resource_name: 'terraform-capstone-jane-old', resource_type: 'terraform-capstone', agent_id: 'agent-1', user_id: 'jane.doe@example.com', state: 'running', latest_task_id: 'prov-old' },
    provision: { ...failed, task_id: 'prov-old', resource_name: 'terraform-capstone-jane-old', status: TaskStatus.COMPLETED },
  };

  function build(opts: { task?: any; labs?: any[] }) {
    const taskQueue = {
      getTask: jest.fn(async (id: string) => (opts.task && opts.task.task_id === id ? opts.task : null)),
      getLabsForAgent: jest.fn(async () => opts.labs ?? []),
    };
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).user = { email: 'jane.doe@example.com' };
      next();
    });
    app.use('/tasks', createTaskRoutes(taskQueue as any, mockServices.logger.mock(), {} as any));
    return { app, taskQueue };
  }

  it('lists the other running lab that holds the port, with the task a teardown targets', async () => {
    const { app } = build({ task: failed, labs: [oldLab] });
    const res = await request(app).get('/tasks/failed-1/retry-conflicts');
    expect(res.status).toBe(200);
    expect(res.body.conflicts).toEqual([
      { resource_name: 'terraform-capstone-jane-old', resource_type: 'terraform-capstone', state: 'running', ports: [4566], provision_task_id: 'prov-old' },
    ]);
    expect(res.body.leftover).toBeNull();
  });

  it('answers with an empty list when nothing is in the way', async () => {
    const { app } = build({ task: failed, labs: [] });
    const res = await request(app).get('/tasks/failed-1/retry-conflicts');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ conflicts: [], leftover: null });
  });

  it('names the half-made VM a failed attempt of the same VM lab may have left', async () => {
    const vmTask = { ...failed, task_id: 'failed-vm', resource_name: 'linux-capstone-a-jane', config: { executor: 'multipass', vm: {} } };
    const lab = {
      resource: { resource_name: 'linux-capstone-a-jane', agent_id: 'agent-1', user_id: 'jane.doe@example.com', state: 'error', latest_task_id: 'failed-vm' },
      provision: vmTask,
    };
    const { app } = build({ task: vmTask, labs: [lab] });
    const res = await request(app).get('/tasks/failed-vm/retry-conflicts');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ conflicts: [], leftover: { resource_name: 'linux-capstone-a-jane', provision_task_id: 'failed-vm' } });
  });

  it('is 404 for an unknown task and 403 for someone else\'s task', async () => {
    const { app } = build({ task: failed });
    expect((await request(app).get('/tasks/nope/retry-conflicts')).status).toBe(404);
    const { app: other, taskQueue } = build({ task: { ...failed, user_id: 'someone.else@example.com' }, labs: [oldLab] });
    const res = await request(other).get('/tasks/failed-1/retry-conflicts');
    expect(res.status).toBe(403);
    expect(taskQueue.getLabsForAgent).not.toHaveBeenCalled();
  });
});

describe('GET /tasks — instructor checks', () => {
  const secretCheck = {
    task_id: 'c1', task_type: TaskType.RUN_CHECK, resource_name: 'lab', status: TaskStatus.COMPLETED, agent_id: 'agent-1', user_id: 'jane.doe@example.com',
    config: { checkName: 'grade', targetTaskId: 't1', job: { image: 'python:3', files: { 'oracle.py': 'c2VjcmV0' }, env: { DB_ADMIN_URL: 'x' } } },
    logs: 'PASS [money] expected 1263 got 1262',
    metadata: { check: { exitCode: 0, output: '{"items":[{"detail":"expected 1263"}]}' } },
    error_message: 'Job exited with 0',
  } as unknown as ProvisioningTask;
  const lab = { task_id: 't1', task_type: TaskType.PROVISION_TRAINING, resource_name: 'lab', status: TaskStatus.COMPLETED, user_id: 'jane.doe@example.com', config: { labId: 'x' }, logs: 'lab log' } as unknown as ProvisioningTask;
  const SECRETS = /oracle|c2VjcmV0|expected 1263|DB_ADMIN_URL|PASS \[money\]/;

  it('does not give a trainee the grader, its logs or its detailed result in the task list', async () => {
    const { app } = setup({ tasks: [secretCheck, lab] });
    const res = await request(app).get('/tasks');
    expect(res.status).toBe(200);
    const row = res.body.tasks.find((t: any) => t.task_id === 'c1');
    expect(JSON.stringify(row)).not.toMatch(SECRETS);
    expect(row.config).toEqual({ checkName: 'grade', targetTaskId: 't1' });
    expect(row.metadata).toEqual({ check: { exitCode: 0 } });
    expect(row.status).toBe('completed');
    // other tasks are untouched
    expect(res.body.tasks.find((t: any) => t.task_id === 't1').logs).toBe('lab log');
  });

  it('does not give a trainee the grader when the check row is fetched by id', async () => {
    const { app } = setup({ tasks: [secretCheck, lab] });
    const res = await request(app).get('/tasks/c1');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(SECRETS);
    expect(res.body.config).toEqual({ checkName: 'grade', targetTaskId: 't1' });
    expect((await request(app).get('/tasks/t1')).body.logs).toBe('lab log');
  });

  it('keeps the full row for the admin list', async () => {
    const { app } = setup({ tasks: [secretCheck] });
    const res = await request(app).get('/tasks/admin/all');
    expect(res.status).toBe(200);
    expect(res.body.tasks[0].config.job.files['oracle.py']).toBe('c2VjcmV0');
    expect(res.body.tasks[0].logs).toContain('expected 1263');
  });

  describe('hideCheckInternals', () => {
    const row = (over: Partial<ProvisioningTask>) => ({ ...secretCheck, ...over } as ProvisioningTask);

    it('replaces an error message that carries grader output, and keeps the plain exit-code ones', () => {
      expect(hideCheckInternals(row({ error_message: 'AssertionError: expected 1263 got 1262' })).error_message).toBe('The check did not complete.');
      expect(hideCheckInternals(row({ error_message: 'Check exited with 1' })).error_message).toBe('Check exited with 1');
      expect(hideCheckInternals(row({ error_message: 'Job exited with -1' })).error_message).toBe('Job exited with -1');
      expect(hideCheckInternals(row({ error_message: undefined })).error_message).toBeUndefined();
    });

    it('keeps nothing of the result when the check has no exit code yet', () => {
      const pending = hideCheckInternals(row({ status: TaskStatus.IN_PROGRESS, metadata: { check: { output: 'secret partial' } } as any, logs: 'partial', error_message: undefined }));
      expect(pending.metadata).toEqual({});
      expect(pending.logs).toBeUndefined();
      expect(JSON.stringify(pending)).not.toMatch(/secret partial|partial/);
    });
  });
});

/**
 * A task runs on the laptop of the agent's owner, so only that person may queue one there (audit 2026-11-07: POST /tasks never
 * compared request.agent_id with the caller; anyone who knew another person's agent id could queue their own compose file onto
 * that person's machine).
 */
describe('POST /tasks — the agent must be the caller\'s', () => {
  const lab = () => body({ labId: 'ministack', dockerCompose: COMPOSE });

  it('queues a task on the caller\'s own agent', async () => {
    const { app, created } = setup({ agentOwner: ME });
    expect((await request(app).post('/tasks').send(lab())).status).toBe(201);
    expect(created).toHaveLength(1);
  });

  it('refuses another user\'s agent (403) and does nothing at all: no task, no wake-up, no probe', async () => {
    const { app, taskQueue, agentService } = setup({ agentOwner: 'victim@example.com' });
    const res = await request(app).post('/tasks').send(lab());
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden', message: 'This agent belongs to another user' });
    expect(taskQueue.createTask).not.toHaveBeenCalled();
    expect(agentService.notifyAgent).not.toHaveBeenCalled();
    expect(agentService.confirmAgentOnline).not.toHaveBeenCalled();
    expect(agentService.isAgentOnline).not.toHaveBeenCalled();
  });

  it('refuses a registration with no owner on record', async () => {
    const { app, taskQueue } = setup({ agentOwner: '' });
    expect((await request(app).post('/tasks').send(lab())).status).toBe(403);
    expect(taskQueue.createTask).not.toHaveBeenCalled();
  });

  it('compares the owner case-insensitively (emails are)', async () => {
    const { app } = setup({ agentOwner: 'Jane.Doe@Example.com' });
    expect((await request(app).post('/tasks').send(lab())).status).toBe(201);
  });

  it('refuses before the VM/version checks, so a foreign agent\'s version is never echoed', async () => {
    const { app } = setup({ agentOwner: 'victim@example.com', agentVersion: '0.1.7' });
    const vm = { agent_id: 'agent-1', task_type: 'provision-training', resource_name: 'linux-x', config: { labId: 'linux-capstone', executor: 'multipass', vm: { image: '24.04' } } };
    const res = await request(app).post('/tasks').send(vm);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain('0.1.7');
  });

  it('an unknown agent id keeps the existing answer (409, not online)', async () => {
    const { app } = setup({ agentOwner: null, online: false, confirmed: false });
    const res = await request(app).post('/tasks').send(lab());
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Agent offline');
  });
});

describe('DELETE /tasks/:id — instructor checks', () => {
  const build = (deleteTask: (id: string, user: string) => Promise<void>) => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).user = { email: ME };
      next();
    });
    app.use('/tasks', createTaskRoutes({ deleteTask } as any, mockServices.logger.mock(), undefined, {}));
    return app;
  };

  it('answers 403 "Instructor checks cannot be deleted" for a protected check row', async () => {
    const { CheckRowProtectedError } = jest.requireActual('../service/TaskQueueService');
    const res = await request(build(async () => { throw new CheckRowProtectedError('c1'); })).delete('/tasks/c1');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden', message: 'Instructor checks cannot be deleted' });
  });

  it('still answers the existing 404 / 403 / 409 for the other refusals', async () => {
    expect((await request(build(async () => { throw new Error('Task x not found'); })).delete('/tasks/x')).status).toBe(404);
    expect((await request(build(async () => { throw new Error('Task x does not belong to user y'); })).delete('/tasks/x')).status).toBe(403);
    expect((await request(build(async () => { throw new Error('Task x is the active state ... and cannot be deleted'); })).delete('/tasks/x')).status).toBe(409);
  });
});
