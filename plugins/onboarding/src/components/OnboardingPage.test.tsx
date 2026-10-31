import React from 'react';
import '@testing-library/jest-dom';
import { screen } from '@testing-library/react';
import { mockApis, renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { configApiRef, githubAuthApiRef, identityApiRef } from '@backstage/core-plugin-api';
import { OnboardingPage } from './OnboardingPage';
import { userManagementApiRef } from '../api/refs';

const renderAs = (opts: { groups: string[]; me: Record<string, unknown> }) =>
  renderInTestApp(
    <TestApiProvider
      apis={[
        [identityApiRef, {
          getBackstageIdentity: async () => ({
            type: 'user',
            userEntityRef: 'user:default/jane.doe',
            ownershipEntityRefs: ['user:default/jane.doe', ...opts.groups.map(g => `group:default/${g}`)],
          }),
          getProfileInfo: async () => ({ displayName: 'Jane Doe', email: 'jane.doe@example.com' }),
        }],
        [githubAuthApiRef, { getAccessToken: async () => '' }],
        [configApiRef, mockApis.config({ data: { organization: { githubOwner: 'example-org' } } })],
        [userManagementApiRef, {
          getMe: async () => opts.me,
          markOnboardingStep: async () => ({}),
          register: async () => ({}),
          linkGithub: async () => ({}),
        }],
      ]}
    >
      <OnboardingPage />
    </TestApiProvider>,
  );

const finishedEngineer = {
  teams: ['web-team'],
  github_username: 'jane',
  onboarding_catalog_tour: true,
  onboarding_engineering_docs: true,
};

describe('OnboardingPage — optional AI setup card', () => {
  it('shows the Claude Code / Codex path to a team engineer, without changing completion', async () => {
    await renderAs({ groups: ['web-team'], me: finishedEngineer });

    expect(await screen.findByText('Optional: AI-assisted development')).toBeInTheDocument();
    expect(screen.getByText('Claude Code setup').closest('a')).toHaveAttribute(
      'href',
      'https://nexus.coderstudio.co/docs#init-claude',
    );
    expect(screen.getByText('Codex setup').closest('a')).toHaveAttribute('target', '_blank');
    expect(screen.queryByText('Set up OpenCode')).not.toBeInTheDocument();

    // The card is not a step: a user who finished the 4 steps is still "all set".
    expect(await screen.findByText('Onboarding complete!')).toBeInTheDocument();
    expect(screen.getByText('4/4')).toBeInTheDocument();
  });

  it('shows the OpenCode / Big Pickle path to a trainee', async () => {
    await renderAs({ groups: ['general-engineers'], me: { teams: [], onboarding_catalog_tour: false, onboarding_engineering_docs: false } });

    expect(await screen.findByText('Set up OpenCode')).toBeInTheDocument();
    expect(screen.getByText(/Big Pickle/)).toBeInTheDocument();
    expect(screen.queryByText('Claude Code setup')).not.toBeInTheDocument();
  });
});
