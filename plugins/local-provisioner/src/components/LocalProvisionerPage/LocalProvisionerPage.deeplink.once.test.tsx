import React from 'react';
import { waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Navigate, Route, Routes } from 'react-router-dom';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { alertApiRef } from '@backstage/core-plugin-api';
import { localProvisionerApiRef } from '../../api/LocalProvisionerClient';
import { justCreatedState } from '../../api/labArrival';
import { LocalProvisionerPage } from './LocalProvisionerPage';

jest.setTimeout(30000);

// The page clears a lab URL that names no lab of yours by navigating. Between that call and the router
// committing the new location, the page can re-run the check (the list fails to load and recovers,
// or reloads). Here navigation does nothing at all, which holds the URL in place for good, so the
// check re-runs: the message must still be posted only once.
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

const UNKNOWN_ID = '3f2b8c1e-5a7d-4e90-9b1c-0d4e6f8a1b2c';

describe('LocalProvisionerPage: a lab URL that names no lab of yours', () => {
  it('posts its message once, however many times the check runs again before the URL is cleared', async () => {
    const state = { fail: false };
    const api: any = {
      getTasks: jest.fn(async () => {
        if (state.fail) throw new Error('Failed to fetch tasks');
        return [];
      }),
      getResources: async () => [],
      getAgents: async () => [],
      getAgentStatus: async () => null,
    };
    const alerts: any[] = [];
    const alertApi: any = { post: (a: any) => alerts.push(a), alert$: () => ({ subscribe: () => ({ unsubscribe() {} }) }) };
    await renderInTestApp(
      <TestApiProvider apis={[[localProvisionerApiRef, api], [alertApiRef, alertApi]]}>
        <Routes>
          <Route path="/local-provisioner/*" element={<LocalProvisionerPage />} />
        </Routes>
      </TestApiProvider>,
      { routeEntries: [`/local-provisioner/tasks/${UNKNOWN_ID}`] },
    );
    await waitFor(() => expect(alerts).toHaveLength(1));
    expect(mockNavigate).toHaveBeenCalledWith('/local-provisioner', { replace: true });

    // The list stops loading (the check is held back) ...
    const callsBeforeFailure = api.getTasks.mock.calls.length;
    state.fail = true;
    await waitFor(() => expect(api.getTasks.mock.calls.length).toBeGreaterThan(callsBeforeFailure), { timeout: 8000 });
    await new Promise(resolve => setTimeout(resolve, 300));
    // ... and loads again: the check runs again with the URL still in place.
    const callsBeforeRecovery = api.getTasks.mock.calls.length;
    state.fail = false;
    await waitFor(() => expect(api.getTasks.mock.calls.length).toBeGreaterThan(callsBeforeRecovery), { timeout: 8000 });
    await new Promise(resolve => setTimeout(resolve, 400));

    expect(alerts).toHaveLength(1);
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });
});

describe('LocalProvisionerPage: a lab you just created', () => {
  it('greets it once, however many times the list refreshes while the arrival mark is still in place', async () => {
    mockNavigate.mockClear();
    const id = '5a1c0b7e-2d4f-4b8a-9c3e-7f6d5e4c3b2a';
    let updatedAt = '2026-11-03T04:00:00Z';
    const api: any = {
      getTasks: jest.fn(async () => [
        { id, agentId: 'a', userId: 'u', taskType: 'provision-training', resourceName: 'local-db-1', config: { labId: 'local-database' }, status: 'pending', createdAt: '2026-11-03T04:00:00Z', updatedAt },
      ]),
      getResources: async () => [],
      getAgents: async () => [],
      getAgentStatus: async () => null,
    };
    const alerts: any[] = [];
    const alertApi: any = { post: (a: any) => alerts.push(a), alert$: () => ({ subscribe: () => ({ unsubscribe() {} }) }) };
    await renderInTestApp(
      <TestApiProvider apis={[[localProvisionerApiRef, api], [alertApiRef, alertApi]]}>
        <Routes>
          <Route path="/start" element={<Navigate to={`/local-provisioner/tasks/${id}`} state={justCreatedState()} replace />} />
          <Route path="/local-provisioner/*" element={<LocalProvisionerPage />} />
        </Routes>
      </TestApiProvider>,
      { routeEntries: ['/start'] },
    );
    await waitFor(() => expect(alerts).toHaveLength(1));
    expect(mockNavigate).toHaveBeenCalledWith(`/local-provisioner/tasks/${id}`, { replace: true, state: null });

    // The task changes (a refresh brings a new object), with the mark still in the location because
    // navigation does nothing here: the lab must not be greeted again.
    const calls = api.getTasks.mock.calls.length;
    updatedAt = '2026-11-03T04:00:09Z';
    await waitFor(() => expect(api.getTasks.mock.calls.length).toBeGreaterThan(calls + 1), { timeout: 10000 });
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(alerts).toHaveLength(1);
  });
});
