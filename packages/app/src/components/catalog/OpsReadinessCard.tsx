/**
 * OpsReadinessCard — "is this service production-ready by our conventions?" (Tech Insights).
 *
 * Calls the tech-insights backend directly (POST /checks/run/:namespace/:kind/:name) instead of
 * using @backstage-community/plugin-tech-insights: its current release nests @backstage/ui 0.17
 * against the app's 0.19 (same problem the Grafana plugin had). Checks + fact retrievers are
 * configured under `techInsights` in app-config.yaml; conventions in
 * docs/content/monitoring-ops-links.md.
 *
 * Backend quirks handled here (verified against tech-insights-backend 3.1.0):
 *   - before the retrievers' first run the API answers 500 "Not all facts are defined" — matched on
 *     that message, so a genuine backend failure (also a 500) still shows as an error
 *   - checks whose facts have no row for this entity are silently omitted from the response
 * Both mean "not evaluated yet", not failure.
 */
import React from 'react';
import useAsync from 'react-use/lib/useAsync';
import { InfoCard } from '@backstage/core-components';
import { useApi, discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { useEntity } from '@backstage/plugin-catalog-react';
import { CheckCircle2, CircleDashed, XCircle } from 'lucide-react';

export const OPS_READINESS_CHECKS = [
  'groupOwnerCheck',
  'descriptionCheck',
  'runbookLinkCheck',
  'dashboardLinkCheck',
  'onCallLinkCheck',
  'grafanaMonitoringCheck',
] as const;

const CONVENTIONS_DOC = '/engineering-docs?source=nexus-idp-docs&path=monitoring-ops-links';

type CheckResult = { check: { id: string; name: string; description: string }; result: boolean };
type Outcome =
  | { kind: 'results'; results: CheckResult[] }
  | { kind: 'not-evaluated' }
  | { kind: 'forbidden' };

const text = (color: string, size = '0.8125rem') => ({ fontSize: size, color, letterSpacing: '-0.006em', lineHeight: 1.5 });

export const OpsReadinessCard = () => {
  const { entity } = useEntity();
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);

  const namespace = entity.metadata.namespace ?? 'default';
  const kind = entity.kind.toLowerCase();
  const name = entity.metadata.name;

  const { value, loading, error } = useAsync(async (): Promise<Outcome> => {
    const base = await discoveryApi.getBaseUrl('tech-insights');
    const res = await fetchApi.fetch(
      `${base}/checks/run/${encodeURIComponent(namespace)}/${encodeURIComponent(kind)}/${encodeURIComponent(name)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checks: OPS_READINESS_CHECKS }),
      },
    );
    if (res.status === 403) return { kind: 'forbidden' };
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (res.status === 500 && body.includes('Not all facts are defined')) return { kind: 'not-evaluated' };
      throw new Error(`Tech Insights returned ${res.status}`);
    }
    const results = (await res.json()) as CheckResult[];
    return results.length ? { kind: 'results', results } : { kind: 'not-evaluated' };
  }, [discoveryApi, fetchApi, namespace, kind, name]);

  const passed = value?.kind === 'results' ? value.results.filter(r => r.result).length : 0;
  const total = value?.kind === 'results' ? value.results.length : OPS_READINESS_CHECKS.length;

  return (
    <InfoCard
      title="Ops readiness"
      subheader={value?.kind === 'results' ? `${passed} of ${total} checks pass` : undefined}
      deepLink={{ title: 'How to fix', link: CONVENTIONS_DOC }}
    >
      {loading && <div style={text('var(--fg-tertiary)')}>Checking…</div>}
      {error && <div style={text('var(--fg-secondary)')}>Couldn't load checks: {error.message}</div>}
      {value?.kind === 'forbidden' && (
        <div style={text('var(--fg-secondary)')}>You don't have access to Tech Insights checks.</div>
      )}
      {value?.kind === 'not-evaluated' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <CircleDashed size={16} strokeWidth={1.5} color="var(--fg-tertiary)" style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={text('var(--fg-secondary)')}>
            Not evaluated yet — checks run hourly. New or just-changed services show up after the next run.
          </div>
        </div>
      )}
      {value?.kind === 'results' && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {value.results.map(r => (
            <li key={r.check.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              {r.result ? (
                <CheckCircle2 size={16} strokeWidth={1.5} color="var(--ds-green-900)" aria-label="pass" style={{ flexShrink: 0, marginTop: 2 }} />
              ) : (
                <XCircle size={16} strokeWidth={1.5} color="var(--ds-red-900)" aria-label="fail" style={{ flexShrink: 0, marginTop: 2 }} />
              )}
              <div>
                <div style={{ ...text('var(--fg-primary)', '0.875rem'), fontWeight: 500 }}>{r.check.name}</div>
                {!r.result && <div style={text('var(--fg-tertiary)')}>{r.check.description}</div>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </InfoCard>
  );
};
