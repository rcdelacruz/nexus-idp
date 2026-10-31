import { Entity } from '@backstage/catalog-model';
import { opsReadinessFacts, opsReadinessFactRetriever } from './techInsightsOpsFacts';

const entity = (metadata: Partial<Entity['metadata']>): Entity => ({
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: { name: 'svc', ...metadata },
  spec: { type: 'service' },
});

describe('opsReadinessFacts', () => {
  it('is all false for a bare entity', () => {
    expect(opsReadinessFacts(entity({}))).toEqual({
      hasRunbookLink: false,
      hasDashboardLink: false,
      hasOnCallLink: false,
      hasGrafanaAnnotation: false,
    });
  });

  it('matches the documented link titles case-insensitively', () => {
    const facts = opsReadinessFacts(
      entity({
        links: [
          { url: 'https://example.com/rb', title: 'Runbook' },
          { url: 'https://example.com/d', title: ' dashboard ' },
          { url: 'https://example.com/oc', title: 'On-call' },
        ],
      }),
    );
    expect(facts).toMatchObject({ hasRunbookLink: true, hasDashboardLink: true, hasOnCallLink: true });
  });

  it('ignores links with other titles or without a URL', () => {
    const facts = opsReadinessFacts(
      entity({ links: [{ url: 'https://example.com', title: 'Runbook draft' }, { url: '', title: 'Runbook' }] }),
    );
    expect(facts.hasRunbookLink).toBe(false);
  });

  it('accepts either Grafana annotation', () => {
    expect(opsReadinessFacts(entity({ annotations: { 'grafana/dashboard-selector': "tags @> 'svc'" } })).hasGrafanaAnnotation).toBe(true);
    expect(opsReadinessFacts(entity({ annotations: { 'grafana/alert-label-selector': 'service=svc' } })).hasGrafanaAnnotation).toBe(true);
    expect(opsReadinessFacts(entity({ annotations: { 'grafana/dashboard-selector': '' } })).hasGrafanaAnnotation).toBe(false);
  });

  it('declares a schema entry for every fact it returns, and filters to services/websites', () => {
    expect(Object.keys(opsReadinessFactRetriever.schema).sort()).toEqual(Object.keys(opsReadinessFacts(entity({}))).sort());
    expect(opsReadinessFactRetriever.entityFilter).toEqual([{ kind: 'component', 'spec.type': ['service', 'website'] }]);
  });
});
