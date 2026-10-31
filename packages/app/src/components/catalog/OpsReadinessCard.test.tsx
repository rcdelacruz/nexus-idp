import React from 'react';
import { screen } from '@testing-library/react';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { EntityProvider } from '@backstage/plugin-catalog-react';
import { Entity } from '@backstage/catalog-model';
import { OpsReadinessCard, OPS_READINESS_CHECKS } from './OpsReadinessCard';

const entity: Entity = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: { name: 'orders api', namespace: 'default' },
  spec: { type: 'service' },
};

const result = (id: string, name: string, pass: boolean) => ({
  check: { id, name, description: `${name} — how to fix` },
  result: pass,
});

const renderWith = (response: { status: number; body?: unknown; text?: string }) => {
  const fetch = jest.fn(async () => ({
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    json: async () => response.body,
    text: async () => response.text ?? '',
  }));
  const utils = renderInTestApp(
    <TestApiProvider
      apis={[
        [discoveryApiRef, { getBaseUrl: async () => 'http://backend/api/tech-insights' }],
        [fetchApiRef, { fetch }],
      ]}
    >
      <EntityProvider entity={entity}>
        <OpsReadinessCard />
      </EntityProvider>
    </TestApiProvider>,
  );
  return { fetch, utils };
};

describe('OpsReadinessCard', () => {
  it('posts the six checks for this entity and shows pass/fail with fix hints', async () => {
    const { fetch } = renderWith({
      status: 200,
      body: [result('runbookLinkCheck', 'Has a runbook link', false), result('groupOwnerCheck', 'Owned by a group', true)],
    });

    expect(await screen.findByText('1 of 2 checks pass')).toBeInTheDocument();
    expect(screen.getByText('Has a runbook link — how to fix')).toBeInTheDocument(); // failing → hint
    expect(screen.queryByText('Owned by a group — how to fix')).not.toBeInTheDocument(); // passing → no hint
    expect(screen.getByLabelText('fail')).toBeInTheDocument();
    expect(screen.getByLabelText('pass')).toBeInTheDocument();

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://backend/api/tech-insights/checks/run/default/component/orders%20api');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ checks: [...OPS_READINESS_CHECKS] });
  });

  it('treats the "facts not collected yet" 500 as "not evaluated yet", not an error', async () => {
    renderWith({ status: 500, text: '{"error":{"name":"Error","message":"Not all facts are defined: opsReadinessFactRetriever"}}' });
    expect(await screen.findByText(/Not evaluated yet/)).toBeInTheDocument();
  });

  it('shows any other 500 as an error, so a real outage is not hidden', async () => {
    renderWith({ status: 500, text: '{"error":{"message":"connect ECONNREFUSED"}}' });
    expect(await screen.findByText(/Couldn't load checks: Tech Insights returned 500/)).toBeInTheDocument();
  });

  it('treats an empty result (no fact rows for this entity yet) as "not evaluated yet"', async () => {
    renderWith({ status: 200, body: [] });
    expect(await screen.findByText(/Not evaluated yet/)).toBeInTheDocument();
  });

  it('explains a 403 instead of showing results', async () => {
    renderWith({ status: 403 });
    expect(await screen.findByText(/don't have access/)).toBeInTheDocument();
  });

  it('shows other failures as an error', async () => {
    renderWith({ status: 502 });
    expect(await screen.findByText(/Couldn't load checks: Tech Insights returned 502/)).toBeInTheDocument();
  });
});
