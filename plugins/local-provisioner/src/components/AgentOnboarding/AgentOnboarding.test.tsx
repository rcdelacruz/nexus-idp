import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderInTestApp } from '@backstage/test-utils';
import { AgentOnboarding } from './AgentOnboarding';

describe('AgentOnboarding', () => {
  it('walks through Docker, install, login, start, in that order', async () => {
    await renderInTestApp(<AgentOnboarding />);
    const titles = screen.getAllByText(/^[1-4]\. /).map(e => e.textContent);
    expect(titles).toEqual([
      '1. Install Docker Desktop (recommended)',
      '2. Install the agent (macOS, Linux; needs Node 20+)',
      '3. Log in (opens your browser)',
      '4. Start the agent',
    ]);
  });

  it('recommends Docker Desktop, with the links to get it and the Linux alternative', async () => {
    await renderInTestApp(<AgentOnboarding />);
    const desktop = screen.getByRole('link', { name: 'Get Docker Desktop' });
    expect(desktop).toHaveAttribute('href', 'https://www.docker.com/products/docker-desktop/');
    expect(desktop).toHaveAttribute('target', '_blank');
    expect(desktop).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(screen.getByRole('link', { name: 'Docker Engine' })).toHaveAttribute('href', 'https://docs.docker.com/engine/install/');
    expect(screen.getByRole('link', { name: 'Multipass' })).toHaveAttribute('href', 'https://multipass.run/');
    expect(screen.getByText(/will not start until Docker is open and says it is running/)).toBeInTheDocument();
  });

  it('shows the installer one-liner of this portal, and copies all of it', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await renderInTestApp(<AgentOnboarding />);
    const expected = `curl -fsSL ${window.location.origin}/api/local-provisioner/agent/install.sh | sh`;
    expect(screen.getByText(expected)).toBeInTheDocument();
    const copyButtons = screen.getAllByRole('button', { name: 'copy command' });
    fireEvent.click(copyButtons[0]);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expected));
  });

  it('keeps the npm command for Windows and says to open a new terminal', async () => {
    await renderInTestApp(<AgentOnboarding />);
    expect(screen.getByText('npm install -g @stratpoint/backstage-agent')).toBeInTheDocument();
    expect(screen.getByText(/open a new terminal window/)).toBeInTheDocument();
  });

  it('still shows login and start', async () => {
    await renderInTestApp(<AgentOnboarding />);
    expect(screen.getByText(`backstage-agent login --url ${window.location.origin}`)).toBeInTheDocument();
    expect(screen.getByText('backstage-agent start')).toBeInTheDocument();
    expect(screen.getByText(/Offline\?/)).toBeInTheDocument();
  });
});
