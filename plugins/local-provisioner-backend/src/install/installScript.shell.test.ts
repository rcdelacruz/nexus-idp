import { spawnSync } from 'child_process';
import path from 'path';

/**
 * Runs install.shell-tests.sh: the real install.sh, in fresh `env -i` terminals that have no node on
 * their PATH (the nvm situation), with a stand-in agent package. Needs sh, dash, bash, zsh and npm;
 * where one is missing the suite is skipped rather than reported as a failure of the script.
 */
const has = (cmd: string) => spawnSync('sh', ['-c', `command -v ${cmd}`]).status === 0;
const ready = ['dash', 'bash', 'zsh', 'npm', 'node'].every(has);
const maybe = ready ? describe : describe.skip;

maybe('install.sh in fresh terminals', () => {
  it('passes every scenario', () => {
    const r = spawnSync('bash', [path.join(__dirname, 'install.shell-tests.sh')], { encoding: 'utf8', timeout: 240_000 });
    const failed = r.stdout.split('\n').filter(l => l.includes('FAIL'));
    expect(failed).toEqual([]);
    expect(r.stdout).toMatch(/passed \d+, failed 0/);
    expect(r.status).toBe(0);
  }, 250_000);
});
