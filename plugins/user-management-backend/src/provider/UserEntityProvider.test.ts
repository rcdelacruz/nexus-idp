import { UserEntityProvider } from './UserEntityProvider';

/**
 * The instructor flag becomes membership of the `instructors` group in the user's catalog entity.
 * Everything that reads the role (Trainees view, capstone management, the sidebar link) reads that
 * group, so this is the line that makes the flag real.
 */
const row = (over: Record<string, unknown>) => ({
  name: 'x',
  display_name: 'X',
  email: 'x@example.com',
  teams: [] as string[],
  is_lead: false,
  is_admin: false,
  is_instructor: false,
  github_username: null,
  ...over,
});

async function emitted(rows: any[]) {
  const mutations: any[] = [];
  const provider = new UserEntityProvider(
    { getAll: async () => rows } as any,
    { run: async (t: { fn: () => Promise<void> }) => t.fn() } as any,
    { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any,
  );
  await provider.connect({ applyMutation: async (m: any) => { mutations.push(m); }, refresh: async () => {} } as any);
  expect(mutations).toHaveLength(1);
  const byName: Record<string, string[]> = {};
  for (const { entity } of mutations[0].entities) byName[entity.metadata.name] = entity.spec.memberOf;
  return byName;
}

describe('UserEntityProvider — instructors', () => {
  it('puts a flagged user in the instructors group, next to their team', async () => {
    const out = await emitted([row({ name: 'ann', teams: ['web-team'], is_instructor: true })]);
    expect(out.ann).toEqual(['general-engineers', 'web-team', 'instructors']);
  });

  it('emits a trainee-only instructor (general-engineers is not a department team)', async () => {
    const out = await emitted([row({ name: 'tess', teams: ['general-engineers'], is_instructor: true })]);
    expect(out.tess).toEqual(['general-engineers', 'instructors']);
  });

  it('keeps lead and admin groups alongside instructors', async () => {
    const out = await emitted([
      row({ name: 'lee', teams: ['cloud-team'], is_lead: true, is_instructor: true }),
      row({ name: 'ada', teams: [], is_admin: true, is_instructor: true }),
    ]);
    expect(out.lee).toEqual(['general-engineers', 'cloud-team', 'cloud-lead', 'instructors']);
    expect(out.ada).toEqual(['general-engineers', 'backstage-admins', 'instructors']);
  });

  it('adds nothing for users without the flag, and still skips ghost rows', async () => {
    const out = await emitted([
      row({ name: 'ann', teams: ['web-team'] }),
      row({ name: 'tess', teams: ['general-engineers'] }),
      row({ name: 'ghost', teams: [] }),
    ]);
    expect(out.ann).toEqual(['general-engineers', 'web-team']);
    expect(Object.keys(out)).toEqual(['ann']);
  });

  it('treats a row from before the column existed (flag undefined) as not an instructor', async () => {
    const out = await emitted([{ ...row({ name: 'old', teams: ['web-team'] }), is_instructor: undefined }]);
    expect(out.old).toEqual(['general-engineers', 'web-team']);
  });
});
