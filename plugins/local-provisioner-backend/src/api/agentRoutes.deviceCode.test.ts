import express from 'express';
import request from 'supertest';
import { mockServices } from '@backstage/backend-test-utils';
import { createAgentRoutes } from './agentRoutes';

/** POST /agent/device/code is unauthenticated: what it accepts, what it passes on, what it logs. */
describe('POST /agent/device/code', () => {
  const logger = mockServices.logger.mock();
  const generateDeviceCode = jest.fn(async (machine?: unknown) => ({ device_code: 'd', user_code: 'ABCD-1234', machine }));
  const app = () => {
    const a = express();
    a.use(express.json());
    a.use('/agent', createAgentRoutes({ generateDeviceCode } as any, logger, {} as any));
    return a;
  };
  const valid = { agent_id: 'agent-mac-a1b2', hostname: 'mac.local', platform: 'darwin', platform_version: 'macOS 26.0 (arm64)', agent_version: '0.1.32' };
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes the machine description on', async () => {
    const res = await request(app()).post('/agent/device/code').send(valid);
    expect(res.status).toBe(200);
    expect(generateDeviceCode).toHaveBeenCalledWith({ agentId: 'agent-mac-a1b2', hostname: 'mac.local', platform: 'darwin', platformVersion: 'macOS 26.0 (arm64)', agentVersion: '0.1.32' });
  });

  it('still works with no body at all', async () => {
    expect((await request(app()).post('/agent/device/code')).status).toBe(200);
    expect(generateDeviceCode).toHaveBeenCalledWith(undefined);
  });

  it('refuses an unusable field with 400 and generates no code', async () => {
    const res = await request(app()).post('/agent/device/code').send({ ...valid, agent_id: 'a b;c' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
    expect(generateDeviceCode).not.toHaveBeenCalled();
  });

  it('never logs what the client sent', async () => {
    await request(app()).post('/agent/device/code').send({ ...valid, hostname: 'SECRET-HOSTNAME-123' });
    await request(app()).post('/agent/device/code').send({ ...valid, agent_id: 'bad id', hostname: 'SECRET-HOSTNAME-456' });
    const logged = JSON.stringify([(logger.info as jest.Mock).mock.calls, (logger.warn as jest.Mock).mock.calls, (logger.debug as jest.Mock).mock.calls, (logger.error as jest.Mock).mock.calls]);
    expect(logged).not.toMatch(/SECRET-HOSTNAME/);
    expect(logged).not.toMatch(/DEBUG/);
  });
});
