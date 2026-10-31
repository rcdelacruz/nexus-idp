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
        task={task({ githubRepoUrl: 'https://github.com/stratpoint-engineering/training-ministack-jane-20261030-1730' })}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('Get the code on your laptop')).toBeInTheDocument();
    expect(screen.getByText('Clone in VS Code').closest('a')).toHaveAttribute(
      'href',
      'vscode://vscode.git/clone?url=https%3A%2F%2Fgithub.com%2Fstratpoint-engineering%2Ftraining-ministack-jane-20261030-1730.git',
    );
    expect(
      screen.getByText(
        'git clone https://github.com/stratpoint-engineering/training-ministack-jane-20261030-1730.git && cd training-ministack-jane-20261030-1730',
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
          ...task({ githubRepoUrl: 'https://github.com/stratpoint-engineering/training-x' }),
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
          ...task({ githubRepoUrl: 'https://github.com/stratpoint-engineering/training-x' }),
          metadata: { workspace: { status: 'failed', hint: 'Run `gh auth login`' } },
        }}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/Automatic clone didn't work: Run `gh auth login`/)).toBeInTheDocument();
    expect(screen.getByText('Clone in VS Code')).toBeInTheDocument();
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
});
