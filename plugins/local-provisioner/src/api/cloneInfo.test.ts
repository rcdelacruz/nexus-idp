import { cloneInfo, invitationUrl, repoReachedByMountedLab } from './cloneInfo';

describe('cloneInfo', () => {
  it('builds the VS Code link and git command for a GitHub repo URL', () => {
    expect(cloneInfo('https://github.com/example-org/training-ministack-jane-20261030-1730')).toEqual({
      vscodeHref:
        'vscode://vscode.git/clone?url=https%3A%2F%2Fgithub.com%2Fexample-org%2Ftraining-ministack-jane-20261030-1730.git',
      command:
        'git clone https://github.com/example-org/training-ministack-jane-20261030-1730.git && cd training-ministack-jane-20261030-1730',
      dir: 'training-ministack-jane-20261030-1730',
    });
  });

  it('handles GitLab subgroups, trailing slashes and an existing .git suffix', () => {
    expect(cloneInfo('https://gitlab.example.com/strat/trainees/devops-capstone-x/')?.command).toBe(
      'git clone https://gitlab.example.com/strat/trainees/devops-capstone-x.git && cd devops-capstone-x',
    );
    expect(cloneInfo('https://github.com/org/repo.git')?.dir).toBe('repo');
  });

  it.each([
    [undefined],
    [''],
    ['http://github.com/org/repo'],
    ['git@github.com:org/repo.git'],
    ['https://github.com/org'],
    ['https://github.com/org/repo; rm -rf ~'],
    ['https://github.com/org/$(whoami)'],
    [['javascript', 'alert(1)'].join(':')],
  ])('rejects %p', url => {
    expect(cloneInfo(url as string | undefined)).toBeUndefined();
  });
});

describe('invitationUrl', () => {
  it('points at the invitations page of the trainee repo', () => {
    expect(invitationUrl('https://github.com/example-org/terraform-capstone-a-jane-doe-20261103-1001')).toBe(
      'https://github.com/example-org/terraform-capstone-a-jane-doe-20261103-1001/invitations',
    );
  });

  it('accepts a .git suffix and a trailing slash, as cloneInfo does', () => {
    expect(invitationUrl('https://github.com/org/repo.git')).toBe('https://github.com/org/repo/invitations');
    expect(invitationUrl('https://github.com/org/repo/')).toBe('https://github.com/org/repo/invitations');
    expect(invitationUrl('  https://github.com/org/repo  ')).toBe('https://github.com/org/repo/invitations');
  });

  it.each([
    [undefined],
    [''],
    ['http://github.com/org/repo'],
    ['git@github.com:org/repo.git'],
    ['https://github.com/org'],
    ['https://github.com/org/repo/tree/main'],
    ['https://github.com/org/repo/invitations'],
    ['https://github.com/org/..'],
    ['https://github.com/org/.'],
    ['https://github.com/-org/repo'],
    ['https://github.com.evil.example/org/repo'],
    ['https://evil.example/github.com/org/repo'],
    ['https://user@github.com/org/repo'],
    ['https://github.com:8443/org/repo'],
    ['https://GitHub.com.evil.example/org/repo'],
    ['https://gitlab.example.com/example/trainees/devops-capstone-x'],
    ['https://github.com/org/repo?x=1'],
    ['https://github.com/org/repo#frag'],
    ['https://github.com/org/repo; rm -rf ~'],
    ['https://github.com/org/$(whoami)'],
  ])('gives none for %p', url => {
    expect(invitationUrl(url as string | undefined)).toBeUndefined();
  });
});

describe('repoReachedByMountedLab', () => {
  const lab = (steps: string[], config: Record<string, unknown> = { workspaceMount: true }) => ({
    config,
    metadata: { activity: steps.map((step, i) => ({ at: `2026-11-03T04:4${i}:00Z`, step })) },
  });

  it('is true once the timeline holds a step after the repo steps', () => {
    expect(repoReachedByMountedLab(lab(['Getting your repo', 'images-cached']))).toBe(true);
    expect(repoReachedByMountedLab(lab(['Getting your repo', 'Waiting for access to your repo', 'Starting the containers']))).toBe(true);
  });

  it('is false while the lab is getting the repo or waiting for access', () => {
    expect(repoReachedByMountedLab(lab(['Getting your repo']))).toBe(false);
    expect(repoReachedByMountedLab(lab(['Getting your repo', 'Waiting for access to your repo']))).toBe(false);
  });

  it('does not count the portal\'s closing markers as steps', () => {
    expect(repoReachedByMountedLab(lab(['Getting your repo', 'Waiting for access to your repo', 'failed']))).toBe(false);
    expect(repoReachedByMountedLab(lab(['Getting your repo', 'completed']))).toBe(false);
  });

  it('uses the LAST repo step: a retry that is waiting again is not past it', () => {
    expect(repoReachedByMountedLab(lab(['Getting your repo', 'images-cached', 'Getting your repo', 'Waiting for access to your repo']))).toBe(false);
    // ... and a repeated "Getting your repo" after later steps starts the count again.
    expect(repoReachedByMountedLab(lab(['Getting your repo', 'Waiting for access to your repo', 'images-cached', 'Getting your repo']))).toBe(false);
  });

  it('is false for a lab that does not mount the repo, whatever its steps', () => {
    expect(repoReachedByMountedLab(lab(['Getting your repo', 'images-cached'], {}))).toBe(false);
    expect(repoReachedByMountedLab(lab(['Getting your repo', 'images-cached'], { workspaceMount: 'true' }))).toBe(false);
  });

  it.each([[undefined], [null], [{}], [{ activity: 'x' }], [{ activity: [null, 5, {}] }]])('is false for odd metadata %p', metadata => {
    expect(repoReachedByMountedLab({ config: { workspaceMount: true }, metadata })).toBe(false);
  });
});
