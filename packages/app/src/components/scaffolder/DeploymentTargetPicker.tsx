/**
 * DeploymentTargetPicker — custom scaffolder field extension.
 *
 * Fetches available deployment targets from the scaffolder-targets backend,
 * which reads from app-config.yaml (scaffolder.targets.*).
 * Filters by framework if provided — e.g. Lambda is excluded for Next.js.
 *
 * Usage in template.yaml:
 *   deploymentTarget:
 *     title: Deployment Target
 *     type: string
 *     ui:field: DeploymentTargetPicker
 *     ui:options:
 *       framework: nextjs   # optional — omit to auto-detect from formData.framework
 */
import React, { useEffect, useState } from 'react';
import { useApi, discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { FieldExtensionComponentProps } from '@backstage/plugin-scaffolder-react';
import {
  FormControl,
  FormControlLabel,
  Radio,
  RadioGroup,
  CircularProgress,
} from '@material-ui/core';
import { useColors, semantic } from '@stratpoint/theme-utils';

interface Target {
  value: string;
  label: string;
}

export const DeploymentTargetPicker = ({
  onChange,
  formData,
  rawErrors,
  uiSchema,
  formContext,
}: FieldExtensionComponentProps<string>) => {
  const c = useColors();
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);
  const [targets, setTargets] = useState<Target[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Framework from ui:options (static, e.g. nextjs-fullstack template)
  // or from formContext (dynamic, e.g. generic-service where user picks framework)
  const framework =
    (uiSchema?.['ui:options']?.framework as string | undefined) ??
    (formContext?.formData?.framework as string | undefined);

  useEffect(() => {
    setLoading(true);
    setError(false);

    const load = async () => {
      try {
        const baseUrl = await discoveryApi.getBaseUrl('scaffolder-targets');
        const params = framework
          ? `?framework=${encodeURIComponent(framework)}`
          : '';
        const res = await fetchApi.fetch(`${baseUrl}/targets${params}`);
        if (!res.ok) throw new Error('Failed to fetch targets');
        const data = await res.json();
        const fetched: Target[] = data.targets ?? [];
        setTargets(fetched);
        // Auto-select if only one target available
        if (fetched.length === 1 && !formData) {
          onChange(fetched[0].value);
        }
      } catch {
        setError(true);
        setTargets([]);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [discoveryApi, fetchApi, framework]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
        <CircularProgress size={14} style={{ color: c.textSecondary }} />
        <span style={{ fontSize: '0.875rem', color: c.textSecondary }}>
          Loading available targets…
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <span style={{ fontSize: '0.875rem', color: semantic.error }}>
        Could not load deployment targets — check backend connection.
      </span>
    );
  }

  if (targets.length === 0) {
    return (
      <span style={{ fontSize: '0.875rem', color: c.textSecondary }}>
        No deployment targets available
        {framework ? ` for ${framework}` : ''}. Ask DevOps to provision infrastructure first.
      </span>
    );
  }

  return (
    <FormControl component="fieldset" error={!!rawErrors?.length}>
      <RadioGroup
        value={formData ?? ''}
        onChange={e => onChange(e.target.value)}
        style={{ gap: 4 }}
      >
        {targets.map(t => (
          <FormControlLabel
            key={t.value}
            value={t.value}
            control={<Radio size="small" style={{ padding: '4px 8px' }} />}
            label={
              <span style={{ fontSize: '0.875rem' }}>{t.label}</span>
            }
          />
        ))}
      </RadioGroup>
      {rawErrors?.length ? (
        <span style={{ fontSize: '0.75rem', color: semantic.error, marginTop: 4 }}>
          {rawErrors[0]}
        </span>
      ) : null}
    </FormControl>
  );
};
