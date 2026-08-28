/**
 * GitLabUsernameField — custom scaffolder field extension.
 *
 * Unlike GitHubUsernameField (invisible, enforced at onboarding), GitLab linking is
 * NOT guaranteed to have happened before a trainee reaches this step — it's only
 * required when they pick the GitLab CI track. So this field is visible: it shows
 * the already-linked username if one exists, or a "Connect GitLab account" button
 * (same OAuth pattern as onboarding's GitHubConnectButton) if not. Required only
 * when the sibling `ciTool` parameter is 'gitlab' — see validateGitLabUsername.
 *
 * Usage in template.yaml:
 *   gitlabUsername:
 *     title: GitLab Username
 *     type: string
 *     ui:field: GitLabUsernameField
 */
import React, { useEffect, useState } from 'react';
import { useApi, discoveryApiRef, fetchApiRef, gitlabAuthApiRef } from '@backstage/core-plugin-api';
import { CustomFieldValidator, FieldExtensionComponentProps } from '@backstage/plugin-scaffolder-react';
import { userManagementApiRef } from '@internal/plugin-user-management';
import { Box, Typography } from '@material-ui/core';
import { GitBranch, Loader, AlertCircle, CheckCircle } from 'lucide-react';

export const GitLabUsernameField = ({
  onChange,
  formData,
  formContext,
}: FieldExtensionComponentProps<string>) => {
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);
  const gitlabAuth = useApi(gitlabAuthApiRef);
  const userManagementApi = useApi(userManagementApiRef);

  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState('');

  const ciTool = (formContext as any)?.formData?.ciTool;
  const isGitlabTrack = ciTool === 'gitlab';

  useEffect(() => {
    const load = async () => {
      try {
        const baseUrl = await discoveryApi.getBaseUrl('user-management');
        const res = await fetchApi.fetch(`${baseUrl}/me`);
        const data = res.ok ? await res.json() : null;
        const username: string | null = data?.user?.gitlab_username ?? null;
        if (username) onChange(username);
      } finally {
        setChecked(true);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discoveryApi, fetchApi]);

  const connect = async () => {
    setLoading(true);
    setError('');
    try {
      const token = await gitlabAuth.getAccessToken(['read_user'], { instantPopup: true });
      const glRes = await fetch('https://gitlab.com/api/v4/user', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!glRes.ok) throw new Error('Could not fetch GitLab profile. Please try again.');
      const glUser = (await glRes.json()) as { username: string };

      await userManagementApi.linkGitlab({ gitlabUsername: glUser.username, oauthToken: token });
      onChange(glUser.username);
    } catch (err: any) {
      if (err?.message?.includes('rejected') || err?.name === 'RejectionError') return;
      setError(err.message ?? 'Failed to connect GitLab. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!isGitlabTrack) {
    // Not on the GitLab track — nothing to show or require.
    return null;
  }

  if (!checked) return null;

  return (
    <Box style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8, marginBottom: 8 }}>
      <Typography style={{ fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-secondary)' }}>
        GitLab Account
      </Typography>

      {formData ? (
        <Box display="flex" alignItems="center" style={{ gap: 6 }}>
          <CheckCircle size={14} strokeWidth={2} color="#22c55e" aria-hidden="true" />
          <Typography style={{ fontSize: '0.875rem' }}>
            Connected as <strong>{formData}</strong>
          </Typography>
        </Box>
      ) : (
        <button
          type="button"
          onClick={connect}
          disabled={loading}
          aria-busy={loading}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '8px 16px', borderRadius: 6, cursor: loading ? 'not-allowed' : 'pointer',
            border: '1px solid var(--border)', background: 'var(--ds-background-100)',
            fontSize: '0.875rem', fontWeight: 500, width: 'fit-content',
          }}
        >
          {loading
            ? <Loader size={14} strokeWidth={1.5} aria-hidden="true" />
            : <GitBranch size={14} strokeWidth={1.5} aria-hidden="true" />}
          {loading ? 'Connecting...' : 'Connect GitLab account'}
        </button>
      )}

      {!formData && (
        <Typography style={{ fontSize: '0.75rem', color: 'var(--fg-secondary)' }}>
          Required for the GitLab CI track — your capstone repo is created under your
          organization's shared GitLab account with you added as an owner.
        </Typography>
      )}

      {error && (
        <Box role="alert" display="flex" alignItems="center" style={{ gap: 6 }}>
          <AlertCircle size={13} color="#e5484d" strokeWidth={1.5} aria-hidden="true" />
          <Typography style={{ color: '#e5484d', fontSize: '0.8125rem' }}>{error}</Typography>
        </Box>
      )}
    </Box>
  );
};

/** Required only when the trainee picked the GitLab CI track (sibling `ciTool` param). */
export const validateGitLabUsername: CustomFieldValidator<string> = (data, field, context) => {
  const ciTool = (context.formData as any)?.ciTool;
  if (ciTool === 'gitlab' && !data?.trim()) {
    field.addError('Connect your GitLab account to continue — required for the GitLab CI track');
  }
};
