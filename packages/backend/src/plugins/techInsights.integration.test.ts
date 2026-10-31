/**
 * End-to-end proof of the "Ops readiness" scorecard backend: the real tech-insights backend +
 * jsonfc fact checker + our ops-readiness module, real knex migrations on an in-memory database,
 * and the real, unmodified `techInsights` config from app-config.yaml. The catalog is a tiny fake plugin serving two services — one that follows every
 * convention, one that follows none — through the same HTTP API the retrievers call.
 */
import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import request from 'supertest';
import express from 'express';
import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import { mockCredentials, mockServices, startTestBackend } from '@backstage/backend-test-utils';
import { Entity } from '@backstage/catalog-model';
import techInsightsPlugin from '@backstage-community/plugin-tech-insights-backend';
import techInsightsJsonFcModule from '@backstage-community/plugin-tech-insights-backend-module-jsonfc';
import techInsightsOpsFactsModule from './techInsightsOpsFacts';

jest.setTimeout(120_000);

const service = (name: string, extra: Partial<Entity['metadata']>, owner: string): Entity => ({
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: { name, namespace: 'default', ...extra },
  spec: { type: 'service', owner, lifecycle: 'production' },
});

const GOOD = service(
  'svc-good',
  {
    description: 'Follows every ops convention',
    links: [
      { url: 'https://example.com/runbook', title: 'Runbook' },
      { url: 'https://example.com/dashboard', title: 'Dashboard' },
      { url: 'https://example.com/oncall', title: 'On-call' },
    ],
    annotations: { 'grafana/dashboard-selector': "tags @> 'svc-good'" },
  },
  'group:default/web-team',
);
const BAD = service('svc-bad', {}, 'user:default/jane.doe');
const LIBRARY: Entity = { ...service('lib-utils', { description: 'A library' }, 'group:default/web-team'), spec: { type: 'library', owner: 'group:default/web-team', lifecycle: 'production' } };
const ENTITIES = [GOOD, BAD, LIBRARY];

const fakeCatalog = createBackendPlugin({
  pluginId: 'catalog',
  register(env) {
    env.registerInit({
      deps: { httpRouter: coreServices.httpRouter },
      async init({ httpRouter }) {
        const router = express.Router();
        router.get('/entities', (_req, res) => res.json(ENTITIES));
        router.get('/entities/by-name/:kind/:namespace/:name', (req, res) => {
          const e = ENTITIES.find(x => x.metadata.name === req.params.name);
          return e ? res.json(e) : res.status(404).end();
        });
        httpRouter.use(router);
        httpRouter.addAuthPolicy({ path: '/', allow: 'unauthenticated' });
      },
    });
  },
});

function realTechInsightsConfig() {
  const appConfig = yaml.parse(fs.readFileSync(path.resolve(__dirname, '../../../../app-config.yaml'), 'utf8'));
  return appConfig.techInsights; // unmodified — the exact config that ships
}

const CHECKS = [
  'groupOwnerCheck',
  'descriptionCheck',
  'runbookLinkCheck',
  'dashboardLinkCheck',
  'onCallLinkCheck',
  'grafanaMonitoringCheck',
];

async function runChecks(server: any, name: string) {
  return request(server)
    .post(`/api/tech-insights/checks/run/default/component/${name}`)
    .set('Authorization', mockCredentials.user.header())
    .send({ checks: CHECKS });
}

describe('tech-insights ops readiness (real backend)', () => {
  it('runs the retrievers and evaluates every configured check per entity', async () => {
    const { server } = await startTestBackend({
      features: [
        techInsightsPlugin,
        techInsightsJsonFcModule,
        techInsightsOpsFactsModule,
        fakeCatalog,
        mockServices.rootConfig.factory({ data: { techInsights: realTechInsightsConfig() } }),
        // The test scheduler runs each task once at startup, but skips tasks that declare an
        // initialDelay unless told otherwise — and opsReadinessFactRetriever declares one.
        mockServices.scheduler.factory({ includeInitialDelayedTasksOnStartup: true }),
      ],
    });

    // Wait until every retriever has stored facts (before that the API answers 500).
    let good: request.Response | undefined;
    for (let i = 0; i < 60; i++) {
      good = await runChecks(server, 'svc-good');
      if (good.status === 200 && good.body.length === CHECKS.length) break;
      await new Promise(r => setTimeout(r, 1000));
    }
    expect(good!.status).toBe(200);
    const goodResults = Object.fromEntries(good!.body.map((r: any) => [r.check.id, r.result]));
    expect(goodResults).toEqual(Object.fromEntries(CHECKS.map(c => [c, true])));

    const bad = await runChecks(server, 'svc-bad');
    expect(bad.status).toBe(200);
    const badResults = Object.fromEntries(bad.body.map((r: any) => [r.check.id, r.result]));
    expect(badResults).toEqual(Object.fromEntries(CHECKS.map(c => [c, false])));

    // Checks are filtered to services/websites: a library gets none (the card hides itself).
    const lib = await runChecks(server, 'lib-utils');
    expect(lib.status).toBe(200);
    expect(lib.body).toEqual([]);

    // The card renders name/description from the check metadata in the response.
    const runbook = good!.body.find((r: any) => r.check.id === 'runbookLinkCheck');
    expect(runbook.check.name).toBe('Has a runbook link');
  });
});
