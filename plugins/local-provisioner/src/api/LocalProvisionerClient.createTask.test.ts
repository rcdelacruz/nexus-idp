import { LocalProvisionerClient } from './LocalProvisionerClient';

/** createTask shows the portal's own explanation for the refusals that carry one (400, 403 not-your-agent, 409 offline). */
describe('LocalProvisionerClient.createTask errors', () => {
  const client = new LocalProvisionerClient({
    discoveryApi: { getBaseUrl: async () => 'http://portal/api/local-provisioner' } as any,
    identityApi: { getCredentials: async () => ({ token: 't' }) } as any,
  });
  const request = { agentId: 'a', taskType: 'provision-training', resourceName: 'r', config: {} } as any;
  const answer = (status: number, body: unknown) => {
    (global as any).fetch = jest.fn(async () => ({ ok: false, status, statusText: 'Nope', json: async () => body }));
  };

  it.each([
    [400, { message: 'bad labId' }, 'bad labId'],
    [403, { error: 'Forbidden', message: 'This agent belongs to another user' }, 'This agent belongs to another user'],
    [409, { message: 'agent offline' }, 'agent offline'],
  ])('%s carries the portal\'s message', async (status, body, expected) => {
    answer(status, body);
    await expect(client.createTask(request)).rejects.toThrow(expected);
  });

  it('any other failure stays generic', async () => {
    answer(500, { message: 'stack trace here' });
    await expect(client.createTask(request)).rejects.toThrow('Failed to create task: Nope');
  });
});
