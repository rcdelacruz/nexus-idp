/**
 * DatabasePicker — custom scaffolder field extension.
 *
 * Renders database options appropriate for the selected deployment target.
 * Supported options per target:
 *   K8s:  None | PostgreSQL (auto-provisioned via CNPG)
 *   AWS:  None | PostgreSQL (RDS) | MySQL (RDS)
 *         PostgreSQL/MySQL are disabled when no RDS instance exists in the
 *         catalog — an always-visible callout guides users to provision one first.
 *
 * Usage in template.yaml:
 *   database:
 *     type: object
 *     ui:field: DatabasePicker
 *
 * Outputs: { database: 'postgresql' | 'mysql' | 'none', rdsInstance: '<entityRef>' }
 * rdsInstance is only set when an AWS relational DB is selected.
 */
import React, { useEffect, useState } from 'react';
import { useApi } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import { FieldExtensionComponentProps } from '@backstage/plugin-scaffolder-react';
import {
  FormControl,
  FormControlLabel,
  Radio,
  RadioGroup,
  CircularProgress,
} from '@material-ui/core';
import { useColors, semantic } from '@stratpoint/theme-utils';

interface DatabasePickerValue {
  database: 'postgresql' | 'mysql' | 'none';
  rdsInstance: string;
}

interface RdsInstance {
  entityRef: string;
  label: string;
}

const AWS_TARGETS = ['ecs', 'app-runner', 'ec2', 'lambda'];
const K8S_TARGETS = ['k8s-selfhosted'];

const DEFAULT_VALUE: DatabasePickerValue = { database: 'none', rdsInstance: '' };

export const DatabasePicker = ({
  onChange,
  formData,
  rawErrors,
  formContext,
}: FieldExtensionComponentProps<DatabasePickerValue>) => {
  const c = useColors();
  const catalogApi = useApi(catalogApiRef);

  const [rdsInstances, setRdsInstances] = useState<RdsInstance[]>([]);
  const [loadingRds, setLoadingRds] = useState(false);
  const [selectedDb, setSelectedDb] = useState<DatabasePickerValue['database']>(formData?.database ?? 'none');
  const [selectedRds, setSelectedRds] = useState<string>(formData?.rdsInstance ?? '');

  const deploymentTarget = formContext?.formData?.deploymentTarget as string | undefined;
  const isAwsTarget = deploymentTarget ? AWS_TARGETS.includes(deploymentTarget) : false;
  const isK8sTarget = deploymentTarget ? K8S_TARGETS.includes(deploymentTarget) : false;

  // Reset selection whenever the deployment target changes
  useEffect(() => {
    setSelectedDb('none');
    setSelectedRds('');
    onChange(DEFAULT_VALUE);
  }, [deploymentTarget]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch available RDS instances from catalog when an AWS target is chosen
  useEffect(() => {
    if (!isAwsTarget) return;
    setLoadingRds(true);
    catalogApi
      .getEntities({
        filter: { kind: 'Resource', 'spec.type': 'rds-instance' },
        fields: ['metadata.name', 'metadata.title', 'metadata.namespace'],
      })
      .then(({ items }) => {
        setRdsInstances(
          items.map(e => ({
            entityRef: `resource:${e.metadata.namespace ?? 'default'}/${e.metadata.name}`,
            label: e.metadata.title ?? e.metadata.name,
          })),
        );
      })
      .catch(() => setRdsInstances([]))
      .finally(() => setLoadingRds(false));
  }, [catalogApi, isAwsTarget]);

  const hasRds = rdsInstances.length > 0;
  const needsRds = selectedDb === 'postgresql' || selectedDb === 'mysql';

  const emit = (db: DatabasePickerValue['database'], rds: string) => {
    onChange({ database: db, rdsInstance: rds });
  };

  const handleDbChange = (db: string) => {
    const typedDb = db as DatabasePickerValue['database'];
    setSelectedDb(typedDb);
    const rds = (typedDb === 'postgresql' || typedDb === 'mysql') ? selectedRds : '';
    emit(typedDb, rds);
  };

  const handleRdsChange = (rds: string) => {
    setSelectedRds(rds);
    emit(selectedDb, rds);
  };

  // ── No target selected yet ────────────────────────────────────────────────
  if (!isK8sTarget && !isAwsTarget) {
    return (
      <span style={{ fontSize: '0.875rem', color: c.textSecondary }}>
        Select a deployment target first.
      </span>
    );
  }

  // ── K8s: None or PostgreSQL (CNPG) ────────────────────────────────────────
  if (isK8sTarget) {
    return (
      <FormControl component="fieldset" error={!!rawErrors?.length}>
        <SectionLabel>Database</SectionLabel>
        <RadioGroup
          value={selectedDb}
          onChange={e => handleDbChange(e.target.value)}
          style={{ gap: 4 }}
        >
          <Option value="none" label="None" />
          <Option value="postgresql" label="PostgreSQL — auto-provisioned via CNPG" />
        </RadioGroup>
      </FormControl>
    );
  }

  // ── AWS: None | PostgreSQL (RDS) | MySQL (RDS) ───────────────────────────
  return (
    <FormControl component="fieldset" error={!!rawErrors?.length} style={{ width: '100%' }}>
      <SectionLabel>Database</SectionLabel>

      {/* Always-visible callout when no RDS exists — never hidden behind a hover tooltip */}
      {!loadingRds && !hasRds && (
        <div style={{
          padding: '10px 14px',
          marginBottom: 12,
          border: '1px solid var(--border)',
          borderLeft: '3px solid #f59e0b',
          borderRadius: 6,
          background: 'var(--ds-background-200)',
          fontSize: '0.875rem',
          lineHeight: 1.5,
          color: c.textSecondary,
        }}>
          <strong style={{ color: c.text, fontWeight: 600 }}>No RDS instances found.</strong>
          {' '}To use PostgreSQL or MySQL,{' '}
          <a
            href="/create/templates/default/infra-aws-rds"
            target="_blank"
            rel="noreferrer"
            style={{ color: '#3b82f6', textDecoration: 'none', fontWeight: 500 }}
          >
            provision an RDS instance first
          </a>
          {' '}then return here.
        </div>
      )}

      <RadioGroup
        value={selectedDb}
        onChange={e => handleDbChange(e.target.value)}
        style={{ gap: 4 }}
      >
        <Option value="none" label="None" />

        {loadingRds ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px' }}>
            <CircularProgress size={12} style={{ color: c.textSecondary }} />
            <span style={{ fontSize: '0.875rem', color: c.textSecondary }}>
              Checking available RDS instances…
            </span>
          </div>
        ) : (
          <>
            <Option value="postgresql" label="PostgreSQL (RDS)" disabled={!hasRds} />
            <Option value="mysql" label="MySQL (RDS)" disabled={!hasRds} />
          </>
        )}
      </RadioGroup>

      {/* RDS instance selector — shown only after a relational DB is chosen */}
      {needsRds && hasRds && (
        <div style={{ marginTop: 16, paddingLeft: 4 }}>
          <SectionLabel>RDS Instance *</SectionLabel>
          <RadioGroup
            value={selectedRds}
            onChange={e => handleRdsChange(e.target.value)}
            style={{ gap: 4 }}
          >
            {rdsInstances.map(r => (
              <Option key={r.entityRef} value={r.entityRef} label={r.label} />
            ))}
          </RadioGroup>
          {!selectedRds && (
            <div style={{ fontSize: '0.75rem', color: semantic.error, marginTop: 4 }}>
              Select an RDS instance to continue
            </div>
          )}
        </div>
      )}
    </FormControl>
  );
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div style={{
    fontSize: '0.6875rem',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--fg-secondary)',
    marginBottom: 8,
  }}>
    {children}
  </div>
);

const Option = ({
  value,
  label,
  disabled = false,
}: {
  value: string;
  label: string;
  disabled?: boolean;
}) => (
  <FormControlLabel
    value={value}
    disabled={disabled}
    control={<Radio size="small" style={{ padding: '4px 8px' }} />}
    label={<span style={{ fontSize: '0.875rem' }}>{label}</span>}
  />
);
