import { openHandoutPr } from './handout';
import { CAPSTONES } from './definitions';

/** In-memory GitHub: one trainee repo with refs, files and pulls; the capstone source file. */
function fakeGithub() {
  const state = {
    refs: new Map<string, string>([['main', 'sha-main']]),
    files: new Map<string, { sha: string; content: string }>(),
    pulls: [] as { head: string; html_url: string; state: string }[],
    calls: [] as string[],
  };
  const reply = (status: number, body?: unknown) => ({ ok: status < 400, status, json: async () => body });
  const fetchImpl = async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body) : undefined;
    state.calls.push(`${method} ${url.replace('https://api.github.com', '')}`);
    const u = new URL(url);
    const p = u.pathname;
    if (p === '/repos/strat-training/nodejs-training-capstone/contents/instructor/day4-handout/auth-cache.ts')
      return reply(200, { content: 'c2Fib3RhZ2Vk\n' });
    if (p === '/repos/stratpoint-engineering/trainee') return reply(200, { default_branch: 'main' });
    const ref = /^\/repos\/stratpoint-engineering\/trainee\/git\/ref\/heads\/(.+)$/.exec(p);
    if (ref && method === 'GET') return state.refs.has(ref[1]) ? reply(200, { object: { sha: state.refs.get(ref[1]) } }) : reply(404);
    if (p === '/repos/stratpoint-engineering/trainee/git/refs' && method === 'POST') {
      state.refs.set(body.ref.replace('refs/heads/', ''), body.sha);
      return reply(201, {});
    }
    const file = /^\/repos\/stratpoint-engineering\/trainee\/contents\/(.+)$/.exec(p);
    if (file && method === 'GET') {
      const f = state.files.get(`${u.searchParams.get('ref')}:${file[1]}`);
      return f ? reply(200, { sha: f.sha }) : reply(404);
    }
    if (file && method === 'PUT') {
      const key = `${body.branch}:${file[1]}`;
      if (state.files.has(key) && body.sha !== state.files.get(key)!.sha) return reply(409);
      if (state.files.has(key) && !body.sha) return reply(422);
      state.files.set(key, { sha: `blob-${state.files.size + 1}`, content: body.content });
      return reply(200, {});
    }
    if (p === '/repos/stratpoint-engineering/trainee/pulls' && method === 'GET') {
      const head = u.searchParams.get('head')!.split(':')[1];
      return reply(200, state.pulls.filter(x => x.head === head && x.state === 'open'));
    }
    if (p === '/repos/stratpoint-engineering/trainee/pulls' && method === 'POST') {
      if (state.pulls.some(x => x.head === body.head && x.state === 'open')) return reply(422);
      const pr = { head: body.head, html_url: `https://github.com/stratpoint-engineering/trainee/pull/${state.pulls.length + 1}`, state: 'open' };
      state.pulls.push(pr);
      return reply(201, pr);
    }
    return reply(404);
  };
  return { state, fetchImpl };
}

describe('openHandoutPr', () => {
  const trainee = { owner: 'stratpoint-engineering', repo: 'trainee' };

  it('creates the branch, the file and the PR from the capstone handout', async () => {
    const { state, fetchImpl } = fakeGithub();
    const r = await openHandoutPr(CAPSTONES.nodejs, trainee, 'tok', fetchImpl as any);
    expect(r).toEqual({ prUrl: 'https://github.com/stratpoint-engineering/trainee/pull/1', created: true });
    expect(state.refs.get('contrib/auth-cache')).toBe('sha-main');
    expect(state.files.get('contrib/auth-cache:src/middleware/auth-cache.ts')?.content).toBe('c2Fib3RhZ2Vk');
    expect(state.calls.every(c => / \/repos\//.test(c))).toBe(true);
  });

  it('is idempotent: a second run reuses the branch, updates the file with its sha and returns the open PR', async () => {
    const { state, fetchImpl } = fakeGithub();
    await openHandoutPr(CAPSTONES.nodejs, trainee, 'tok', fetchImpl as any);
    const again = await openHandoutPr(CAPSTONES.nodejs, trainee, 'tok', fetchImpl as any);
    expect(again).toEqual({ prUrl: 'https://github.com/stratpoint-engineering/trainee/pull/1', created: false });
    expect(state.pulls).toHaveLength(1);
    expect(state.calls.filter(c => c.startsWith('POST') && c.endsWith('/git/refs'))).toHaveLength(1);
  });
});
