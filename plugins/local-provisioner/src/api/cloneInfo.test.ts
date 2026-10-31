import { cloneInfo } from './cloneInfo';

describe('cloneInfo', () => {
  it('builds the VS Code link and git command for a GitHub repo URL', () => {
    expect(cloneInfo('https://github.com/stratpoint-engineering/training-ministack-jane-20261030-1730')).toEqual({
      vscodeHref:
        'vscode://vscode.git/clone?url=https%3A%2F%2Fgithub.com%2Fstratpoint-engineering%2Ftraining-ministack-jane-20261030-1730.git',
      command:
        'git clone https://github.com/stratpoint-engineering/training-ministack-jane-20261030-1730.git && cd training-ministack-jane-20261030-1730',
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
