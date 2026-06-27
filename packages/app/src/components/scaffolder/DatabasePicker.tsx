/**
 * DatabasePicker — custom scaffolder field extension.
 *
 * Renders database options appropriate for the selected deployment target.
 * Supported options per target:
 *   K8s:  None | PostgreSQL (auto-provisioned via CNPG) | <DBaaS entities>
 *   AWS:  None | PostgreSQL (RDS) | MySQL (RDS) | <DBaaS entities>
 *         RDS options are disabled when no RDS instance exists in the catalog.
 *         DBaaS entities are auto-discovered from connected accounts (Settings → Connect Databases).
 *
 * Usage in template.yaml:
 *   database:
 *     type: object
 *     ui:field: DatabasePicker
 *
 * Outputs: { database: 'postgresql' | 'mysql' | 'none' | 'external-db', rdsInstance: '<entityRef>', dbaasEntityRef: '<entityRef>' }
 * rdsInstance is only set when an AWS relational DB is selected.
 * dbaasEntityRef is only set when an auto-discovered DBaaS database is selected.
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
import { dbaasApiRef } from '@internal/plugin-dbaas';

interface DatabasePickerValue {
  database: 'postgresql' | 'mysql' | 'none' | 'external-db' | 'create-new';
  rdsInstance: string;
  dbaasEntityRef: string;
  /** Set when database === 'create-new': the provider id (e.g. 'neon') */
  createProvider: string;
}

interface RdsInstance {
  entityRef: string;
  label: string;
}

interface DbaasEntity {
  entityRef: string;
  displayName: string;
}

const AWS_TARGETS = ['ecs', 'app-runner', 'ec2', 'lambda'];
const K8S_TARGETS = ['k8s-selfhosted'];

const DEFAULT_VALUE: DatabasePickerValue = { database: 'none', rdsInstance: '', dbaasEntityRef: '', createProvider: '' };

// Derive provider display name from the annotation value — no hardcoding.
// e.g. 'neon' → 'Neon', 'cockroachdb' → 'Cockroachdb', 'planetscale' → 'Planetscale'
function providerLabel(annotationValue: string): string {
  return annotationValue.charAt(0).toUpperCase() + annotationValue.slice(1);
}

export const DatabasePicker = ({
  onChange,
  formData,
  rawErrors,
  formContext,
}: FieldExtensionComponentProps<DatabasePickerValue>) => {
  const c = useColors();
  const catalogApi = useApi(catalogApiRef);
  const dbaasApi = useApi(dbaasApiRef);

  const [rdsInstances, setRdsInstances] = useState<RdsInstance[]>([]);
  const [loadingRds, setLoadingRds] = useState(false);
  const [dbaasEntities, setDbaasEntities] = useState<DbaasEntity[]>([]);
  const [loadingDbaas, setLoadingDbaas] = useState(true);
  // Providers the user has connected that support on-demand project creation
  const [creatableProviders, setCreatableProviders] = useState<Array<{ id: string; displayName: string }>>([]);
  const [loadingCreatable, setLoadingCreatable] = useState(true);
  const [creatableError, setCreatableError] = useState<string | undefined>(undefined);

  // Single selection string: 'none' | 'postgresql' | 'mysql' | <dbaas entityRef>
  const [selectedOption, setSelectedOption] = useState<string>(
    formData?.dbaasEntityRef ? formData.dbaasEntityRef : (formData?.database ?? 'none'),
  );
  const [selectedRds, setSelectedRds] = useState<string>(formData?.rdsInstance ?? '');

  const deploymentTarget = formContext?.formData?.deploymentTarget as string | undefined;
  const isAwsTarget = deploymentTarget ? AWS_TARGETS.includes(deploymentTarget) : false;
  const isK8sTarget = deploymentTarget ? K8S_TARGETS.includes(deploymentTarget) : false;

  // Reset selection whenever the deployment target changes
  useEffect(() => {
    setSelectedOption('none');
    setSelectedRds('');
    onChange(DEFAULT_VALUE);
  }, [deploymentTarget]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch user's connected providers that support on-demand project creation
  useEffect(() => {
    setLoadingCreatable(true);
    setCreatableError(undefined);
    Promise.all([dbaasApi.getProviders(), dbaasApi.getConnections()])
      .then(([providers, connections]) => {
        // Unique providers the user has a connection for, that support creation
        const connectedProviderIds = new Set(connections.map(c => c.provider));
        setCreatableProviders(
          providers
            .filter(p => p.supportsCreate && connectedProviderIds.has(p.id))
            .map(p => ({ id: p.id, displayName: p.displayName })),
        );
      })
      .catch((err: any) => {
        setCreatableProviders([]);
        setCreatableError(err?.message ?? 'Could not load connected database accounts');
      })
      .finally(() => setLoadingCreatable(false));
  }, [dbaasApi]);

  // Fetch DBaaS entities from catalog — always, independent of target.
  // Filters in JS by presence of 'dbaas/provider' annotation.
  useEffect(() => {
    setLoadingDbaas(true);
    catalogApi
      .getEntities({
        filter: { kind: 'Resource' },
        fields: ['metadata.name', 'metadata.namespace', 'metadata.title', 'metadata.annotations'],
      })
      .then(({ items }) => {
        setDbaasEntities(
          items
            .filter(e => !!e.metadata.annotations?.['dbaas/provider'])
            .map(e => ({
              entityRef: `resource:${e.metadata.namespace ?? 'default'}/${e.metadata.name}`,
              // e.g. "Neon: my-project-db" — derived entirely from entity data
              displayName: `${providerLabel(e.metadata.annotations!['dbaas/provider'])}: ${e.metadata.title ?? e.metadata.name}`,
            })),
        );
      })
      .catch(() => setDbaasEntities([]))
      .finally(() => setLoadingDbaas(false));
  }, [catalogApi]);

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
  const isRdsOption = selectedOption === 'postgresql' || selectedOption === 'mysql';
  const needsRds = isAwsTarget && isRdsOption;

  const emit = (db: DatabasePickerValue['database'], rds: string, dbaasRef: string, createProvider = '') => {
    onChange({ database: db, rdsInstance: rds, dbaasEntityRef: dbaasRef, createProvider });
  };

  const handleOptionChange = (value: string) => {
    setSelectedOption(value);
    const isDbaasEntity = dbaasEntities.some(e => e.entityRef === value);
    const isCreateNew = value.startsWith('create-new:');
    if (isCreateNew) {
      const providerId = value.replace('create-new:', '');
      setSelectedRds('');
      emit('create-new', '', '', providerId);
    } else if (isDbaasEntity) {
      setSelectedRds('');
      emit('external-db', '', value, '');
    } else {
      const typedDb = value as 'none' | 'postgresql' | 'mysql';
      if (typedDb !== 'postgresql' && typedDb !== 'mysql') setSelectedRds('');
      emit(typedDb, (typedDb === 'postgresql' || typedDb === 'mysql') ? selectedRds : '', '', '');
    }
  };

  const handleRdsChange = (rds: string) => {
    setSelectedRds(rds);
    emit(selectedOption as 'postgresql' | 'mysql', rds, '');
  };

  // ── No target selected yet ────────────────────────────────────────────────
  if (!isK8sTarget && !isAwsTarget) {
    return (
      <span style={{ fontSize: '0.875rem', color: c.textSecondary }}>
        Select a deployment target first.
      </span>
    );
  }

  const dbaasOptions = dbaasEntities.map(db => (
    <Option key={db.entityRef} value={db.entityRef} label={db.displayName} />
  ));

  const dbaasLoadingRow = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px' }}>
      <CircularProgress size={12} style={{ color: c.textSecondary }} />
      <span style={{ fontSize: '0.875rem', color: c.textSecondary }}>
        Checking connected databases…
      </span>
    </div>
  );

  const creatableRows = loadingCreatable
    ? null
    : creatableError
      ? (
        <div style={{ fontSize: '0.8125rem', color: semantic.error, padding: '4px 8px', marginBottom: 4 }}>
          {creatableError}
        </div>
      )
      : creatableProviders.map(p => (
          <Option
            key={`create-new:${p.id}`}
            value={`create-new:${p.id}`}
            label={`${p.displayName} — create new project (uses your connected account)`}
          />
        ));

  // ── K8s: None | PostgreSQL (CNPG) | DBaaS create-new | DBaaS entities ─────
  if (isK8sTarget) {
    return (
      <FormControl component="fieldset" error={!!rawErrors?.length}>
        <SectionLabel>Database</SectionLabel>
        <RadioGroup
          value={selectedOption}
          onChange={e => handleOptionChange(e.target.value)}
          style={{ gap: 4 }}
        >
          <Option value="none" label="None" />
          <Option value="postgresql" label="PostgreSQL — auto-provisioned via CNPG" />
          {creatableRows}
          {loadingDbaas ? dbaasLoadingRow : dbaasOptions}
        </RadioGroup>
      </FormControl>
    );
  }

  // ── AWS: None | PostgreSQL (RDS) | MySQL (RDS) | DBaaS entities ───────────
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
        value={selectedOption}
        onChange={e => handleOptionChange(e.target.value)}
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

        {creatableRows}
        {loadingDbaas ? dbaasLoadingRow : dbaasOptions}
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
