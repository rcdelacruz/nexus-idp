import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { mockServices } from '@backstage/backend-test-utils';
import { createCapstoneEnrollAction, createCapstoneLinkRepoAction, safeJoin } from './capstoneEnroll';

const b64 = (s: string) => Buffer.from(s).toString('base64');

function setup() {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'capstone-action-'));
  const outputs: Record<string, unknown> = {};
  const ctx = (input: Record<string, unknown>) =>
    ({
      input,
      workspacePath,
      logger: mockServices.logger.mock(),
      output: (k: string, v: unknown) => {
        outputs[k] = v;
      },
      getInitiatorCredentials: async () => ({ principal: { type: 'user', userEntityRef: 'user:default/jane' } }),
    }) as any;
  const deps = {
    discovery: { getBaseUrl: async () => 'http://backend/api/local-provisioner', getExternalBaseUrl: async () => '' } as any,
    auth: { getPluginRequestToken: jest.fn(async () => ({ token: 'obo-token' })) } as any,
  };
  return { workspacePath, outputs, ctx, deps };
}

describe('stratpoint:capstone-enroll', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('enrolls on behalf of the user and writes the seeded files into the workspace', async () => {
    const { workspacePath, outputs, ctx, deps } = setup();
    const calls: any[] = [];
    global.fetch = jest.fn(async (url: any, init: any) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({
          enrollment: { id: 'e1', traineeNo: '07' },
          files: { 'HANDOVER.md': b64('handover'), 'data/kalye.db': b64('db'), '.env': b64('JWT_SECRET="planted"') },
        }),
        { status: 201 },
      );
    }) as any;

    await createCapstoneEnrollAction(deps).handler(ctx({ capstone: 'nodejs', targetPath: './trainee-repo' }));

    expect(calls[0].url).toBe('http://backend/api/local-provisioner/capstones/enrollments');
    expect(calls[0].init.headers.Authorization).toBe('Bearer obo-token');
    expect(JSON.parse(calls[0].init.body)).toEqual({ capstone: 'nodejs' });
    expect(deps.auth.getPluginRequestToken).toHaveBeenCalledWith(expect.objectContaining({ targetPluginId: 'local-provisioner' }));
    expect(fs.readFileSync(path.join(workspacePath, 'trainee-repo/data/kalye.db'), 'utf8')).toBe('db');
    expect(fs.readFileSync(path.join(workspacePath, 'trainee-repo/.env'), 'utf8')).toContain('planted');
    expect(outputs).toEqual({ enrollmentId: 'e1', traineeNumber: '07' });
  });

  it('refuses files that would escape the workspace', async () => {
    const { ctx, deps } = setup();
    global.fetch = jest.fn(async () =>
      new Response(JSON.stringify({ enrollment: { id: 'e1', traineeNo: '01' }, files: { '../../etc/evil': b64('x') } }), { status: 201 }),
    ) as any;
    await expect(createCapstoneEnrollAction(deps).handler(ctx({ capstone: 'nodejs', targetPath: './trainee-repo' }))).rejects.toThrow(
      /outside the workspace/,
    );
  });

  it('surfaces a backend failure', async () => {
    const { ctx, deps } = setup();
    global.fetch = jest.fn(async () => new Response(JSON.stringify({ error: 'x', message: 'seed blew up' }), { status: 500 })) as any;
    await expect(createCapstoneEnrollAction(deps).handler(ctx({ capstone: 'nodejs', targetPath: './t' }))).rejects.toThrow(
      'Capstone enrollment failed (500): seed blew up',
    );
  });
});

describe('stratpoint:capstone-enroll — laptop-seeded', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('writes the seed script for the lab and outputs the token and report URL', async () => {
    const { workspacePath, outputs, ctx, deps } = setup();
    global.fetch = jest.fn(async () =>
      new Response(
        JSON.stringify({
          enrollment: { id: 'e9', traineeNo: '03' },
          files: { 'README.md': b64('tf') },
          laptopSeed: { token: 'T'.repeat(43), reportUrl: 'https://p/api/local-provisioner/capstones/seed-report/e9', files: { 'seed_prod.py': b64('print(1)') } },
        }),
        { status: 201 },
      ),
    ) as any;
    await createCapstoneEnrollAction(deps).handler(ctx({ capstone: 'terraform', targetPath: './trainee-repo', seedFilesPath: './rendered/seed' }));
    expect(fs.readFileSync(path.join(workspacePath, 'rendered/seed/seed_prod.py'), 'utf8')).toBe('print(1)');
    expect(outputs).toMatchObject({ enrollmentId: 'e9', traineeNumber: '03', seedToken: 'T'.repeat(43), seedReportUrl: 'https://p/api/local-provisioner/capstones/seed-report/e9' });
  });

  it('requires seedFilesPath for a laptop-seeded capstone', async () => {
    const { ctx, deps } = setup();
    global.fetch = jest.fn(async () =>
      new Response(JSON.stringify({ enrollment: { id: 'e9', traineeNo: '03' }, files: {}, laptopSeed: { token: 't', reportUrl: 'u', files: {} } }), { status: 201 }),
    ) as any;
    await expect(createCapstoneEnrollAction(deps).handler(ctx({ capstone: 'terraform', targetPath: './t' }))).rejects.toThrow(/seedFilesPath/);
  });
});

describe('stratpoint:capstone-link-repo', () => {
  it('PUTs the repo URL for the enrollment', async () => {
    const { ctx, deps } = setup();
    const fetchMock = jest.fn(async () => new Response('{}', { status: 200 }));
    const realFetch = global.fetch;
    global.fetch = fetchMock as any;
    try {
      await createCapstoneLinkRepoAction(deps).handler(ctx({ enrollmentId: 'e1', repoUrl: 'https://github.com/o/r' }));
    } finally {
      global.fetch = realFetch;
    }
    const [url, init] = (fetchMock.mock.calls[0] as unknown) as [string, any];
    expect(url).toBe('http://backend/api/local-provisioner/capstones/enrollments/e1/repo');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ repoUrl: 'https://github.com/o/r' });
  });
});

describe('safeJoin', () => {
  it.each([['a/b'], ['./a'], ['.']])('allows %s', rel => {
    expect(() => safeJoin('/ws', rel)).not.toThrow();
  });
  it.each([['../x'], ['/etc/passwd'], ['a/../../x']])('refuses %s', rel => {
    expect(() => safeJoin('/ws', rel)).toThrow();
  });
});
