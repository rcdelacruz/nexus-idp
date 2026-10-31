import React from 'react';
import { screen } from '@testing-library/react';
import { renderInTestApp, TestApiProvider, mockApis } from '@backstage/test-utils';
import { configApiRef, discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { GitHubUsernameField, githubAccountProblem } from './GitHubUsernameField';

const config = mockApis.config({ data: { organization: { githubOwner: 'stratpoint-engineering' } } });

const renderWith = async (linked: string | null) => {
  let value: string | undefined;
  await renderInTestApp(
    <TestApiProvider
      apis={[
        [configApiRef, config],
        [discoveryApiRef, { getBaseUrl: async () => 'http://um' }],
        [fetchApiRef, { fetch: async () => ({ ok: true, json: async () => ({ user: { github_username: linked } }) }) }],
      ]}
    >
      <Field onValue={v => (value = v)} />
    </TestApiProvider>,
  );
  return () => value;
};

/** The real field, re-rendered with whatever it reports through onChange (like the scaffolder form). */
function Field({ onValue }: { onValue: (v: string) => void }) {
  const [v, setV] = React.useState<string | undefined>(undefined);
  return (
    <GitHubUsernameField
      {...({} as any)}
      formData={v}
      onChange={(next: string) => {
        setV(next);
        onValue(next);
      }}
    />
  );
}

describe('GitHubUsernameField', () => {
  it('shows the trainee which account their repo will be shared with', async () => {
    const value = await renderWith('rcdelacruz');
    expect(await screen.findByText(/Your repository will be shared with/)).toBeInTheDocument();
    expect(screen.getByText('@rcdelacruz')).toBeInTheDocument();
    expect(value()).toBe('rcdelacruz');
  });

  it("blocks the organization's own account with a way to fix it (the 2026-10-31 Linux run)", async () => {
    await renderWith('stratpoint-engineering');
    expect(await screen.findByRole('alert')).toHaveTextContent(/the organization's own GitHub account/);
    expect(screen.getByText('Open the GitHub step on the Onboarding page').closest('a')).toHaveAttribute('href', '/onboarding');
  });

  it('blocks a profile with no linked account', async () => {
    await renderWith(null);
    expect(await screen.findByRole('alert')).toHaveTextContent('No GitHub account is linked to your profile.');
  });

  it('validation rules', () => {
    expect(githubAccountProblem('rcdelacruz', 'stratpoint-engineering')).toBeUndefined();
    expect(githubAccountProblem('Stratpoint-Engineering', 'stratpoint-engineering')).toMatch(/organization's own/);
    expect(githubAccountProblem('', 'stratpoint-engineering')).toMatch(/No GitHub account/);
    expect(githubAccountProblem('anyone', undefined)).toBeUndefined();
  });
});
