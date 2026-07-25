/**
 * SuggestedResourceNameField — custom scaffolder field extension.
 *
 * Pre-fills a suggested resource name (kafka-training-<trainee>-<datetime>) from the
 * current user's identity, once, on first load — unlike GitHubUsernameField this stays
 * editable; it's a starting suggestion, not a locked value.
 *
 * Usage in template.yaml:
 *   resourceName:
 *     title: Resource Name
 *     type: string
 *     ui:field: SuggestedResourceName
 */
import React, { useEffect, useRef, useState } from 'react';
import { useApi, discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { FieldExtensionComponentProps } from '@backstage/plugin-scaffolder-react';
import { TextField } from '@material-ui/core';

function sanitize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

function formatDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export const SuggestedResourceNameField = ({
  onChange,
  formData,
  required,
  rawErrors,
}: FieldExtensionComponentProps<string>) => {
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);
  const suggested = useRef(false);
  const [value, setValue] = useState(formData ?? '');

  useEffect(() => {
    // Only ever suggest once, and only if the field is still empty — never overwrite
    // something the trainee already typed.
    if (suggested.current || formData) return;
    suggested.current = true;

    const load = async () => {
      try {
        const baseUrl = await discoveryApi.getBaseUrl('user-management');
        const res = await fetchApi.fetch(`${baseUrl}/me`);
        const data = res.ok ? await res.json() : null;
        const rawName: string = data?.user?.name ?? data?.user?.display_name ?? 'trainee';
        const name = sanitize(rawName) || 'trainee';
        const next = `kafka-training-${name}-${formatDateTime(new Date())}`;
        setValue(next);
        onChange(next);
      } catch {
        // Auto-fill is a convenience, not a requirement — leave the field empty for the
        // trainee to fill in manually if it fails.
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discoveryApi, fetchApi]);

  return (
    <TextField
      label="Resource Name"
      value={value}
      required={required}
      error={!!rawErrors?.length}
      helperText={
        rawErrors?.length
          ? rawErrors[0]
          : 'Suggested name — edit freely, must be lowercase letters, numbers, and hyphens'
      }
      onChange={e => {
        setValue(e.target.value);
        onChange(e.target.value);
      }}
    />
  );
};
