/**
 * GitHubUsernameField — custom scaffolder field extension.
 *
 * Invisible on purpose: silently resolves the current user's already-linked GitHub
 * account (`user-management`'s `GET /me`) in the background and populates the parameter
 * value — no visible field, nothing for the trainee to look at or fill in. The template
 * still marks it `required`: GitHub linking is already enforced at onboarding, so
 * repo creation is mandatory, not a soft/skippable fallback.
 *
 * Usage in template.yaml:
 *   githubUsername:
 *     title: GitHub Username
 *     type: string
 *     ui:field: GitHubUsernameField
 */
import { useEffect } from 'react';
import { useApi, discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { FieldExtensionComponentProps } from '@backstage/plugin-scaffolder-react';

export const GitHubUsernameField = ({
  onChange,
}: FieldExtensionComponentProps<string>) => {
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);

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
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discoveryApi, fetchApi]);

  return null;
};
