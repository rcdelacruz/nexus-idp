/**
 * Tech Insights module: "ops readiness" facts for services and websites.
 *
 * Mirrors the conventions in docs/content/monitoring-ops-links.md:
 *   - metadata.links titled Runbook / Dashboard / On-call (matched case-insensitively)
 *   - grafana/dashboard-selector or grafana/alert-label-selector annotations (Monitoring tab)
 *
 * The retriever only runs when `techInsights.factRetrievers.opsReadinessFactRetriever` is
 * configured (the tech-insights backend schedules retrievers from config). The engine passes
 * `entityFilter` to the handler but does not apply it, so the handler filters the catalog query
 * itself — same as the built-in retrievers. Handler errors are swallowed by the engine, so they
 * are logged here.
 */
import { createBackendModule } from '@backstage/backend-plugin-api';
import { CatalogClient } from '@backstage/catalog-client';
import { Entity } from '@backstage/catalog-model';
import {
  FactRetriever,
  TechInsightFact,
  techInsightsFactRetrieversExtensionPoint,
} from '@backstage-community/plugin-tech-insights-node';

export const OPS_READINESS_RETRIEVER_ID = 'opsReadinessFactRetriever';

const hasLinkTitled = (entity: Entity, titles: string[]): boolean =>
  (entity.metadata.links ?? []).some(
    link => !!link.url && titles.includes((link.title ?? '').trim().toLowerCase()),
  );

/** Pure fact computation — exported for unit tests. */
export function opsReadinessFacts(entity: Entity) {
  const annotations = entity.metadata.annotations ?? {};
  return {
    hasRunbookLink: hasLinkTitled(entity, ['runbook']),
    hasDashboardLink: hasLinkTitled(entity, ['dashboard']),
    hasOnCallLink: hasLinkTitled(entity, ['on-call', 'oncall', 'on call']),
    hasGrafanaAnnotation:
      !!annotations['grafana/dashboard-selector'] || !!annotations['grafana/alert-label-selector'],
  };
}

export const opsReadinessFactRetriever: FactRetriever = {
  id: OPS_READINESS_RETRIEVER_ID,
  version: '0.1.0',
  title: 'Ops readiness',
  description: 'Runbook, dashboard and on-call links plus Grafana monitoring annotations on services and websites',
  entityFilter: [{ kind: 'component', 'spec.type': ['service', 'website'] }],
  schema: {
    hasRunbookLink: { type: 'boolean', description: 'metadata.links has a link titled "Runbook"' },
    hasDashboardLink: { type: 'boolean', description: 'metadata.links has a link titled "Dashboard"' },
    hasOnCallLink: { type: 'boolean', description: 'metadata.links has a link titled "On-call"' },
    hasGrafanaAnnotation: {
      type: 'boolean',
      description: 'grafana/dashboard-selector or grafana/alert-label-selector annotation is set',
    },
  },
  async handler({ discovery, auth, logger, entityFilter }): Promise<TechInsightFact[]> {
    try {
      const { token } = await auth.getPluginRequestToken({
        onBehalfOf: await auth.getOwnServiceCredentials(),
        targetPluginId: 'catalog',
      });
      const { items } = await new CatalogClient({ discoveryApi: discovery }).getEntities(
        {
          filter: entityFilter,
          fields: ['kind', 'metadata.name', 'metadata.namespace', 'metadata.links', 'metadata.annotations'],
        },
        { token },
      );
      return items.map(entity => ({
        entity: {
          namespace: entity.metadata.namespace ?? 'default',
          kind: entity.kind,
          name: entity.metadata.name,
        },
        facts: opsReadinessFacts(entity),
      }));
    } catch (error) {
      logger.error(`${OPS_READINESS_RETRIEVER_ID} failed: ${(error as Error).message}`);
      throw error;
    }
  },
};

/** Registers the ops-readiness retriever with the tech-insights backend. */
export const techInsightsOpsFactsModule = createBackendModule({
  pluginId: 'tech-insights',
  moduleId: 'ops-readiness-facts',
  register(reg) {
    reg.registerInit({
      deps: { providers: techInsightsFactRetrieversExtensionPoint },
      async init({ providers }) {
        providers.addFactRetrievers({ [OPS_READINESS_RETRIEVER_ID]: opsReadinessFactRetriever });
      },
    });
  },
});

export default techInsightsOpsFactsModule;
