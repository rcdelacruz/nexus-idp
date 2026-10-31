/**
 * HTTP-level tests for the generic provision-training type through the real task router:
 * POST /tasks validation (400s, ordering vs. the offline-agent 409) and the docs link on GET.
 * TaskQueueService / AgentService are stubbed — no database.
 */

import express from 'express';
import request from 'supertest';
import { mockServices } from '@backstage/backend-test-utils';
import { createTaskRoutes } from './taskRoutes';
import { ProvisioningTask, TaskStatus, TaskType } from '../types';

const COMPOSE = 'services:\n  app:\n    image: busybox\n';

function setup(opts: { online?: boolean; tasks?: Partial<ProvisioningTask>[] } = {}) {
  const created: any[] = [];
  const taskQueue = {
    createTask: jest.fn(async (userId: string, req: any) => {
      const task = { task_id: 't-new', user_id: userId, status: TaskStatus.PENDING, ...req };
      created.push(task);
      return task;
    }),
    getTasksForUser: jest.fn(async () => (opts.tasks ?? []) as ProvisioningTask[]),
    getResourceState: jest.fn(async () => undefined),
  };
  const agentService = {
    isAgentOnline: jest.fn(async () => opts.online ?? true),
    notifyAgent: jest.fn(),
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { email: 'jane.doe@example.com' };
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

describe('GET /tasks/admin/trainees', () => {
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

  it('is served by the trainees handler, not shadowed by /:taskId', async () => {
    const listTrainees = jest.fn(async () => [{ resourceName: 'lab-a' }]);
    const { app, taskQueue } = build({ listTrainees });
    const res = await request(app).get('/tasks/admin/trainees?refresh=1');
    expect(res.status).toBe(200);
    expect(res.body.trainees).toEqual([{ resourceName: 'lab-a' }]);
    expect(listTrainees).toHaveBeenCalledWith({ refresh: true });
    expect(taskQueue.getTask).not.toHaveBeenCalled();
  });

  it('answers 501 when the service is not wired', async () => {
    const res = await request(build().app).get('/tasks/admin/trainees');
    expect(res.status).toBe(501);
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
    const agentService = { isAgentOnline: async () => true, notifyAgent: jest.fn(), getAgentById: async () => ({ agent_version: agentVersion }) };
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

  it('still requires a VM spec for a multipass lab', async () => {
    const { app } = build('0.1.23');
    const res = await request(app).post('/tasks').send({ ...vmTask, config: { labId: 'linux-capstone', executor: 'multipass' } });
    expect(res.status).toBe(400);
  });
});
