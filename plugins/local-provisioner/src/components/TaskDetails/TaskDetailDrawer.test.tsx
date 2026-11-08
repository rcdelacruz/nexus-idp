import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TaskDetailDrawer } from './TaskDetailDrawer';
import { ProvisioningTask } from '../../api/types';

const task = (config: Record<string, unknown>): ProvisioningTask =>
  ({
    id: 't1',
    agentId: 'agent-1',
    userId: 'user:default/jane.doe',
    taskType: 'provision-training',
    resourceName: 'ministack-jane-20261030-1730',
    config: { labId: 'ministack', ...config },
    status: 'completed',
    createdAt: '2026-10-30T09:00:00Z',
    updatedAt: '2026-10-30T09:01:00Z',
  }) as ProvisioningTask;

describe('TaskDetailDrawer — get the code on your laptop', () => {
  it('shows a VS Code clone link and the git command for the trainee repo', () => {
    render(
      <TaskDetailDrawer
        task={task({ githubRepoUrl: 'https://github.com/example-org/training-ministack-jane-20261030-1730' })}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('Get the code on your laptop')).toBeInTheDocument();
    expect(screen.getByText('Clone in VS Code').closest('a')).toHaveAttribute(
      'href',
      'vscode://vscode.git/clone?url=https%3A%2F%2Fgithub.com%2Fexample-org%2Ftraining-ministack-jane-20261030-1730.git',
    );
    expect(
      screen.getByText(
        'git clone https://github.com/example-org/training-ministack-jane-20261030-1730.git && cd training-ministack-jane-20261030-1730',
      ),
    ).toBeInTheDocument();
  });

  it('shows nothing to clone when the resource has no companion repo', () => {
    render(<TaskDetailDrawer task={task({})} onClose={() => {}} />);
    expect(screen.queryByText('Get the code on your laptop')).not.toBeInTheDocument();
  });

  it('shows where the agent cloned the code, with Open in VS Code, instead of the clone button', () => {
    render(
      <TaskDetailDrawer
        task={{
          ...task({ githubRepoUrl: 'https://github.com/example-org/training-x' }),
          metadata: { workspace: { status: 'cloned', path: '/Users/jane/stratpoint/training-x' } },
        }}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('Your code')).toBeInTheDocument();
    expect(screen.getByText('/Users/jane/stratpoint/training-x')).toBeInTheDocument();
    expect(screen.getByText('Open in VS Code').closest('a')).toHaveAttribute('href', 'vscode://file/Users/jane/stratpoint/training-x');
    expect(screen.queryByText('Clone in VS Code')).not.toBeInTheDocument();
  });

  it('keeps the clone button and explains when the automatic clone failed', () => {
    render(
      <TaskDetailDrawer
        task={{
          ...task({ githubRepoUrl: 'https://github.com/example-org/training-x' }),
          metadata: { workspace: { status: 'failed', hint: 'Run `gh auth login`' } },
        }}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/Automatic clone didn't work: Run `gh auth login`/)).toBeInTheDocument();
    expect(screen.getByText('Clone in VS Code')).toBeInTheDocument();
  });
});


describe('TaskDetailDrawer — accept the GitHub invitation', () => {
  const REPO = 'https://github.com/example-org/terraform-capstone-a-ron-20261103-1001';
  const INVITE = `${REPO}/invitations`;
  const button = () => screen.queryByText('Accept the GitHub invitation');

  it('offers the invitation in every lab that has a GitHub repo, not only the Node.js ones', () => {
    // A Terraform lab: no workspace-mount wait, so the agent attached no button of its own.
    render(<TaskDetailDrawer showInvitation task={{ ...task({ labId: 'terraform-capstone-a', githubRepoUrl: REPO }), status: 'in-progress' } as ProvisioningTask} onClose={() => {}} />);
    const link = button()!.closest('a')!;
    expect(link).toHaveAttribute('href', INVITE);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('sits in "Get the code on your laptop", after the failed-clone hint and before Clone in VS Code', () => {
    render(
      <TaskDetailDrawer
        showInvitation
        task={{
          ...task({ githubRepoUrl: REPO }),
          metadata: { workspace: { status: 'failed', hint: 'GitHub says the repository is not found for your git login. Accept the repository invitation first.' } },
        }}
        onClose={() => {}}
      />,
    );
    const hint = screen.getByText(/Automatic clone didn't work/);
    const invite = button()!;
    const clone = screen.getByText('Clone in VS Code');
    const section = screen.getByText('Get the code on your laptop');
    const before = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before(section, hint)).toBe(true);
    expect(before(hint, invite)).toBe(true);
    expect(before(invite, clone)).toBe(true);
  });

  it('shows for a finished lab whose clone has not happened (an older agent, or a lab that failed)', () => {
    render(<TaskDetailDrawer showInvitation task={task({ githubRepoUrl: REPO })} onClose={() => {}} />);
    expect(button()).toBeInTheDocument();
  });

  it.each([
    ['cloned', { status: 'cloned', path: '/Users/ron/stratpoint/repo' }],
    ['already there', { status: 'existing', path: '/Users/ron/stratpoint/repo' }],
  ])('is gone once the code is on the laptop (%s)', (_name, workspace) => {
    render(<TaskDetailDrawer showInvitation task={{ ...task({ githubRepoUrl: REPO }), metadata: { workspace } }} onClose={() => {}} />);
    expect(screen.getByText('Your code')).toBeInTheDocument();
    expect(button()).not.toBeInTheDocument();
  });

  it('is not shown for a lab with no repo (Local Database) or a GitLab repo', () => {
    const { unmount } = render(<TaskDetailDrawer showInvitation task={task({})} onClose={() => {}} />);
    expect(button()).not.toBeInTheDocument();
    unmount();
    render(<TaskDetailDrawer showInvitation task={task({ gitlabRepoUrl: 'https://gitlab.example.com/example/trainees/devops-capstone-x' })} onClose={() => {}} />);
    expect(screen.getByText('Get the code on your laptop')).toBeInTheDocument();
    expect(button()).not.toBeInTheDocument();
  });

  it.each([
    ['another host', 'https://evil.example/example-org/repo'],
    ['a look-alike host', 'https://github.com.evil.example/example-org/repo'],
    ['a page inside the repo', `${REPO}/tree/main`],
  ])('is not shown for a repo URL on %s', (_name, githubRepoUrl) => {
    render(<TaskDetailDrawer showInvitation task={task({ githubRepoUrl })} onClose={() => {}} />);
    expect(button()).not.toBeInTheDocument();
  });

  it('is shown on a lab that FAILED because the invitation was never accepted (the real Node.js lab, 2026-11-03)', () => {
    const REPO_N = 'https://github.com/example-org/nodejs-capstone-a-ryanangelo-albarico-20261103-1241';
    const failedNode = {
      ...task({ labId: 'nodejs-capstone-a', githubRepoUrl: REPO_N }),
      resourceName: 'nodejs-capstone-a-ryanangelo-albarico-20261103-1241',
      status: 'failed',
      errorMessage:
        "Could not get your repo (https://github.com/example-org/nodejs-capstone-a-ryanangelo-albarico-20261103-1241.git): fatal: repository 'https://github.com/example-org/nodejs-capstone-a-ryanangelo-albarico-20261103-1241.git/' not found. GitHub says the repository is not found for your git login. Accept the repository invitation first (email, or github.com/notifications), make sure `gh auth login` is the account you linked in the portal, then clone with the button in the portal.",
      metadata: {
        activity: [
          { at: '2026-11-03T12:41:10Z', step: 'Getting your repo' },
          { at: '2026-11-03T12:41:11Z', step: 'Waiting for access to your repo' },
          { at: '2026-11-03T13:11:12Z', step: 'failed' },
        ],
      },
    } as ProvisioningTask;
    render(<TaskDetailDrawer showInvitation task={failedNode} onClose={() => {}} />);
    // The error is shown, and so is the button the error tells the trainee to use, before "Clone in VS Code".
    expect(screen.getByText(/Could not get your repo/)).toBeInTheDocument();
    expect(screen.getAllByText('Accept the GitHub invitation')).toHaveLength(1);
    expect(button()!.closest('a')).toHaveAttribute('href', `${REPO_N}/invitations`);
    expect(Boolean(button()!.compareDocumentPosition(screen.getByText('Clone in VS Code')) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it('is shown once for a Node.js lab that is waiting for repo access (the agent already put it in Activity)', () => {
    const waiting = {
      ...task({ labId: 'nodejs-capstone-a', githubRepoUrl: REPO }),
      status: 'in-progress',
      metadata: {
        phase: 'Waiting for access to your repo',
        action: { label: 'Accept the GitHub invitation', url: INVITE },
        activity: [
          { at: '2026-10-31T04:53:40Z', step: 'Getting your repo' },
          { at: '2026-10-31T04:53:41Z', step: 'Waiting for access to your repo' },
        ],
      },
    } as ProvisioningTask;
    render(<TaskDetailDrawer showInvitation task={waiting} onClose={() => {}} />);
    expect(screen.getAllByText('Accept the GitHub invitation')).toHaveLength(1);
    expect(screen.getByText(/accept the GitHub invitation for your new repo/)).toBeInTheDocument();
  });

  it('is shown for a Node.js lab whose agent button points at a different repo', () => {
    const other = {
      ...task({ labId: 'nodejs-capstone-a', githubRepoUrl: REPO }),
      status: 'in-progress',
      metadata: {
        action: { label: 'Accept the GitHub invitation', url: 'https://github.com/someone-else/other/invitations' },
        activity: [{ at: '2026-10-31T04:53:41Z', step: 'Waiting for access to your repo' }],
      },
    } as ProvisioningTask;
    render(<TaskDetailDrawer showInvitation task={other} onClose={() => {}} />);
    expect(screen.getAllByText('Accept the GitHub invitation')).toHaveLength(2);
  });

  it('is off by default: a view of someone else\'s lab (the admin Activity tab) offers no invitation', () => {
    render(<TaskDetailDrawer task={task({ githubRepoUrl: REPO })} onClose={() => {}} />);
    expect(screen.getByText('Get the code on your laptop')).toBeInTheDocument();
    expect(button()).not.toBeInTheDocument();
  });

  describe('a Node.js lab, which clones its repo before anything else', () => {
    const node = (steps: string[], over: Partial<ProvisioningTask> = {}) =>
      ({
        ...task({ labId: 'nodejs-capstone-a', githubRepoUrl: REPO, workspaceMount: true }),
        status: 'in-progress',
        metadata: { activity: steps.map((step, i) => ({ at: `2026-11-03T04:4${i}:00Z`, step })) },
        ...over,
      }) as ProvisioningTask;

    it('hides the button once a step after the repo steps is running (the repo is on the laptop; the agent reports it only at the end)', () => {
      render(<TaskDetailDrawer showInvitation task={node(['Getting your repo', 'Waiting for access to your repo', 'images-cached', 'Starting the containers'])} onClose={() => {}} />);
      expect(screen.getByText('Get the code on your laptop')).toBeInTheDocument();
      expect(button()).not.toBeInTheDocument();
    });

    it('keeps it while the lab is still getting the repo, or waiting for access', () => {
      const { unmount } = render(<TaskDetailDrawer showInvitation task={{ ...node(['Getting your repo']), metadata: { activity: [{ at: '2026-11-03T04:40:00Z', step: 'Getting your repo' }] } } as ProvisioningTask} onClose={() => {}} />);
      expect(button()).toBeInTheDocument();
      unmount();
      render(<TaskDetailDrawer showInvitation task={node(['Getting your repo', 'Waiting for access to your repo'], { status: 'completed' })} onClose={() => {}} />);
      expect(button()).toBeInTheDocument();
    });

    it('keeps it on a lab that failed while waiting: the portal\'s closing "failed" marker is not a step past the wait', () => {
      render(<TaskDetailDrawer showInvitation task={node(['Getting your repo', 'Waiting for access to your repo', 'failed'], { status: 'failed' })} onClose={() => {}} />);
      expect(button()).toBeInTheDocument();
    });

    it('does the same for any other lab: steps after the repo steps prove nothing when the lab does not mount the repo', () => {
      render(
        <TaskDetailDrawer
          showInvitation
          task={{
            ...task({ labId: 'terraform-capstone-a', githubRepoUrl: REPO }),
            status: 'in-progress',
            metadata: { activity: [{ at: '2026-11-03T04:40:00Z', step: 'Getting your repo' }, { at: '2026-11-03T04:41:00Z', step: 'images-cached' }] },
          } as ProvisioningTask}
          onClose={() => {}}
        />,
      );
      expect(button()).toBeInTheDocument();
    });
  });
});

describe('TaskDetailDrawer — activity', () => {
  const running = {
    ...task({}),
    resourceName: 'linux-capstone-x',
    status: 'in-progress',
    startedAt: '2026-10-31T00:25:13Z',
    metadata: {
      phase: 'seeding the server (10–20 min)',
      output: 'Setting up nginx (1.24.0-2ubuntu7) ...',
      activity: [
        { at: '2026-10-31T00:25:15Z', step: 'creating the VM' },
        { at: '2026-10-31T00:29:51Z', step: 'copying seed.sh' },
        { at: '2026-10-31T00:29:52Z', step: 'seeding the server (10–20 min)' },
      ],
    },
  } as ProvisioningTask;

  it('shows every step, marks the running one with its typical duration, and the live output', () => {
    render(<TaskDetailDrawer task={running} onClose={() => {}} />);
    expect(screen.getByText('Activity')).toBeInTheDocument();
    expect(screen.getByText('Creating the VM')).toBeInTheDocument();
    expect(screen.getByText('Copying the lab files into the VM')).toBeInTheDocument();
    expect(screen.getByText('Setting up the server')).toBeInTheDocument();
    expect(screen.getByText('usually 10–20 min')).toBeInTheDocument();
    expect(screen.getByText('4 min')).toBeInTheDocument(); // creating the VM took 4 min 36 s
    expect(screen.getByText('Setting up nginx (1.24.0-2ubuntu7) ...')).toBeInTheDocument();
  });

  it('a finished lab keeps its timeline, ends at Ready and hides live output', () => {
    const done = {
      ...running,
      status: 'completed',
      completedAt: '2026-10-31T00:36:10Z',
      metadata: { ...running.metadata, activity: [...(running.metadata as any).activity, { at: '2026-10-31T00:36:10Z', step: 'completed' }] },
    } as ProvisioningTask;
    render(<TaskDetailDrawer task={done} onClose={() => {}} />);
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.queryByText('usually 10–20 min')).not.toBeInTheDocument();
    expect(screen.queryByText('Setting up nginx (1.24.0-2ubuntu7) ...')).not.toBeInTheDocument();
  });

  it('an older task without a timeline shows no Activity section', () => {
    render(<TaskDetailDrawer task={task({})} onClose={() => {}} />);
    expect(screen.queryByText('Activity')).not.toBeInTheDocument();
  });

  it('waiting for repo access: what to do, with the invitation as a button (2026-10-31 Node.js lab)', () => {
    const waiting = {
      ...running,
      metadata: {
        phase: 'Waiting for access to your repo',
        output: "Your repo o/nodejs-capstone-x isn't reachable from this machine yet.\n1. Accept the GitHub invitation (once): https://github.com/o/nodejs-capstone-x/invitations",
        action: { label: 'Accept the GitHub invitation', url: 'https://github.com/o/nodejs-capstone-x/invitations' },
        activity: [
          { at: '2026-10-31T04:53:40Z', step: 'Getting your repo' },
          { at: '2026-10-31T04:53:41Z', step: 'Waiting for access to your repo' },
        ],
      },
    } as ProvisioningTask;
    render(<TaskDetailDrawer task={waiting} onClose={() => {}} />);
    expect(screen.getByText(/accept the GitHub invitation for your new repo/)).toBeInTheDocument();
    expect(screen.getByText('Accept the GitHub invitation').closest('a')).toHaveAttribute('href', 'https://github.com/o/nodejs-capstone-x/invitations');
  });

  it('never shows a button that points anywhere but GitHub/GitLab', () => {
    const evil = { ...running, metadata: { ...(running.metadata as any), action: { label: 'Accept', url: 'https://evil.example/x' } } } as ProvisioningTask;
    render(<TaskDetailDrawer task={evil} onClose={() => {}} />);
    expect(screen.queryByText('Accept')).not.toBeInTheDocument();
  });
});
