/**
 * GitHubUsernameField — custom scaffolder field extension.
 *
 * Resolves the current user's linked GitHub account (`user-management`'s `GET /me`), fills the
 * parameter with it, and shows the trainee which account their new repo will be shared with.
 * validateGitHubUsername blocks the run when no account is linked or when it is the
 * organization's own account (organization.githubOwner), which GitHub refuses as a collaborator.
 *
 * Usage in template.yaml:
 *   githubUsername:
 *     title: GitHub Username
 *     type: string
 *     ui:field: GitHubUsernameField
 */
import React, { useEffect, useState } from 'react';
import { Box, Typography } from '@material-ui/core';
import { AlertCircle, CheckCircle } from 'lucide-react';
import { useApi, configApiRef, discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { CustomFieldValidator, FieldExtensionComponentProps } from '@backstage/plugin-scaffolder-react';

/** It used to be invisible: a trainee linked to the org account got a repo nobody was invited to (2026-10-31). */
export const GitHubUsernameField = ({ onChange, formData }: FieldExtensionComponentProps<string>) => {
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);
  const githubOwner = useApi(configApiRef).getOptionalString('organization.githubOwner');
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const baseUrl = await discoveryApi.getBaseUrl('user-management');
        const res = await fetchApi.fetch(`${baseUrl}/me`);
        if (!res.ok) throw new Error('request failed');
        const data = await res.json();
        const username: string | null = data.user?.github_username ?? null;
        onChange(username ?? '');
      } catch {
        onChange('');
      } finally {
        setChecked(true);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discoveryApi, fetchApi]);

  if (!checked) return null;
  const problem = githubAccountProblem(formData, githubOwner);
  return (
    <Box style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8, marginBottom: 8 }}>
      <Typography style={{ fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-secondary)' }}>
        GitHub account
      </Typography>
      {problem ? (
        <Box role="alert" display="flex" alignItems="flex-start" style={{ gap: 6 }}>
          <AlertCircle size={14} strokeWidth={1.5} color="#e5484d" aria-hidden="true" style={{ marginTop: 2 }} />
          <Typography style={{ color: '#e5484d', fontSize: '0.8125rem' }}>
            {problem} <a href="/onboarding">Open the GitHub step on the Onboarding page</a>.
          </Typography>
        </Box>
      ) : (
        <Box display="flex" alignItems="center" style={{ gap: 6 }}>
          <CheckCircle size={14} strokeWidth={2} color="#22c55e" aria-hidden="true" />
          <Typography style={{ fontSize: '0.875rem' }}>
            Your repository will be shared with <strong>@{formData}</strong>. Use this account to clone it.
          </Typography>
        </Box>
      )}
    </Box>
  );
};

/** Why the linked account can't be used, or undefined when it can. */
export function githubAccountProblem(username: string | undefined, githubOwner: string | undefined): string | undefined {
  if (!username?.trim()) return 'No GitHub account is linked to your profile.';
  if (githubOwner && username.trim().toLowerCase() === githubOwner.toLowerCase()) {
    return `Your profile is linked to @${username}, the organization's own GitHub account — your repository can't be shared with it. Link your personal GitHub account.`;
  }
  return undefined;
}

export const validateGitHubUsername: CustomFieldValidator<string> = (data, field, context) => {
  const owner = context.apiHolder.get(configApiRef)?.getOptionalString('organization.githubOwner');
  const problem = githubAccountProblem(data, owner);
  if (problem) field.addError(problem);
};
