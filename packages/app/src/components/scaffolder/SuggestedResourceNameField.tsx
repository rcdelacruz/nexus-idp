/**
 * SuggestedResourceNameField — custom scaffolder field extension.
 *
 * Auto-fills the resource name (<prefix>-<trainee>-<datetime>) from the current user's
 * identity, once, on first load — read-only. Unlike a real suggestion, the trainee cannot
 * edit or type over it; it exists so the generated value is still visible, not so it can
 * be changed. If it needs to change, that's a decision for this component, not a typo a
 * trainee can introduce. `prefix` MUST be set per-template via ui:options — it has no
 * template-specific default, so every template using this field needs its own prefix.
 *
 * Usage in template.yaml:
 *   resourceName:
 *     title: Resource Name
 *     type: string
 *     ui:field: SuggestedResourceName
 *     ui:options:
 *       prefix: devops-capstone-training
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
  uiSchema,
}: FieldExtensionComponentProps<string>) => {
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);
  const suggested = useRef(false);
  const [value, setValue] = useState(formData ?? '');
  const prefix = (uiSchema?.['ui:options']?.prefix as string | undefined) ?? 'resource';

  useEffect(() => {
    // Only ever generate once, and only if the field is still empty — never overwrite an
    // already-generated value (e.g. on a re-render or step back/forward in the wizard).
    if (suggested.current || formData) return;
    suggested.current = true;

    const load = async () => {
      try {
        const baseUrl = await discoveryApi.getBaseUrl('user-management');
        const res = await fetchApi.fetch(`${baseUrl}/me`);
        const data = res.ok ? await res.json() : null;
        const rawName: string = data?.user?.name ?? data?.user?.display_name ?? 'trainee';
        const name = sanitize(rawName) || 'trainee';
        const next = `${prefix}-${name}-${formatDateTime(new Date())}`;
        setValue(next);
        onChange(next);
      } catch {
        // Auto-fill is a convenience, not a requirement — leave the field empty if it fails
        // rather than blocking the trainee (there's no manual entry path anymore, so an
        // empty value here means the Next button stays disabled until a retry succeeds).
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
      disabled
      error={!!rawErrors?.length}
      helperText={
        rawErrors?.length ? rawErrors[0] : 'Auto-generated from your account and the current time'
      }
    />
  );
};
