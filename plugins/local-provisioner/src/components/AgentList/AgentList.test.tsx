import React from 'react';
import { screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderInTestApp } from '@backstage/test-utils';
import { AgentList } from './AgentList';
import { AgentRegistration } from '../../api/types';

const agent = (p: Partial<AgentRegistration>): AgentRegistration =>
  ({
    id: 'agent-mac-1',
    userId: 'ann@example.com',
    hostname: 'anns-macbook',
    platformVersion: 'macOS 26.0 (arm64)',
    agentVersion: '0.1.25',
    lastSeenAt: new Date().toISOString(),
    isConnected: true,
    explicitlyDisconnected: false,
    ...p,
  }) as AgentRegistration;

describe('AgentList — agent version', () => {
  it('shows the version each agent runs', async () => {
    await renderInTestApp(<AgentList agents={[agent({})]} loading={false} />);
    expect(screen.getByText(/Agent v0\.1\.25/)).toBeInTheDocument();
    expect(screen.queryByText(/update available/)).not.toBeInTheDocument();
  });

  it('tells the trainee to update an outdated agent', async () => {
    await renderInTestApp(<AgentList agents={[agent({ agentVersion: '0.1.22', updateAvailable: true, latestAgentVersion: '0.1.26' })]} loading={false} />);
    expect(screen.getByText(/Agent v0\.1\.22/)).toBeInTheDocument();
    expect(screen.getByText(/update available \(v0\.1\.26\)/)).toBeInTheDocument();
    expect(screen.getByText('backstage-agent update')).toBeInTheDocument();
  });
});

describe('AgentList — requirements', () => {
  it('reminds the trainee that Docker Desktop is needed, under the list of agents', async () => {
    await renderInTestApp(<AgentList agents={[agent({})]} loading={false} />);
    expect(screen.getByText('Before you start')).toBeInTheDocument();
    expect(screen.getByText('Docker Desktop (recommended)')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Get Docker Desktop/ })).toHaveAttribute('href', 'https://www.docker.com/products/docker-desktop/');
    expect(screen.getByText(/Multipass \(Linux server labs only\)/)).toBeInTheDocument();
  });
});
