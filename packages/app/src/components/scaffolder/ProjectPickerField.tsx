/**
 * ProjectPickerField — custom scaffolder field extension.
 *
 * Fetches active projects from the project-registration backend and renders
 * a Geist-styled Autocomplete. System projects (Internal Tools, R&D/Experiments)
 * are always shown at the top. Returns project UUID as the form value.
 *
 * Usage in template.yaml:
 *   projectId:
 *     title: Project
 *     type: string
 *     ui:field: ProjectPicker
 */
import React, { useEffect, useState } from 'react';
import { useApi, discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { FieldExtensionComponentProps } from '@backstage/plugin-scaffolder-react';
import { TextField, CircularProgress, Typography } from '@material-ui/core';
import Autocomplete from '@material-ui/lab/Autocomplete';
import { useColors } from '@stratpoint/theme-utils';

interface Project {
  id: string;
  name: string;
  client_name: string;
  type: string; // 'system' | 'client'
  status: string;
}

export const ProjectPickerField = ({
  onChange,
  formData,
  required,
  rawErrors,
}: FieldExtensionComponentProps<string>) => {
  const c = useColors();
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const baseUrl = await discoveryApi.getBaseUrl('project-registration');
        const res = await fetchApi.fetch(`${baseUrl}/projects`);
        if (!res.ok) throw new Error('Failed to fetch');
        const data = await res.json();
        setProjects(data.projects ?? []);
      } catch {
        setError(true);
        setProjects([]);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [discoveryApi, fetchApi]);

  const selected = projects.find(p => p.id === formData) ?? null;

  const getGroupLabel = (type: string) =>
    type === 'system' ? 'Default' : 'Client Projects';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Autocomplete
        options={[...projects].sort((a, b) => {
          // System projects first
          if (a.type === 'system' && b.type !== 'system') return -1;
          if (a.type !== 'system' && b.type === 'system') return 1;
          return a.name.localeCompare(b.name);
        })}
        groupBy={p => getGroupLabel(p.type)}
        getOptionLabel={p => p.name}
        getOptionSelected={(a, b) => a.id === b.id}
        value={selected}
        onChange={(_, val) => onChange(val?.id ?? '')}
        loading={loading}
        renderInput={params => (
          <TextField
            {...params}
            label="Project"
            required={required}
            error={!!rawErrors?.length || error}
            helperText={(() => {
              if (rawErrors?.length) return rawErrors[0];
              if (error) return 'Could not load projects — check your connection';
              return undefined;
            })()}
            InputProps={{
              ...params.InputProps,
              endAdornment: (
                <>
                  {loading && (
                    <CircularProgress
                      size={14}
                      style={{ color: c.textSecondary }}
                    />
                  )}
                  {params.InputProps.endAdornment}
                </>
              ),
            }}
          />
        )}
        noOptionsText={
          <span style={{ fontSize: '0.875rem', color: c.textSecondary }}>
            No projects found.
          </span>
        }
      />
      <Typography
        variant="caption"
        style={{ color: c.textSecondary, lineHeight: 1.5 }}
      >
        Use <strong>Internal Tools</strong> or <strong>R&amp;D / Experiments</strong> for
        non-client work.{' '}
        <a
          href="/project-registration"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: c.blue, textDecoration: 'none' }}
        >
          Register a client project →
        </a>
      </Typography>
    </div>
  );
};
