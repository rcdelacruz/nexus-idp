import React from 'react';
// eslint-disable-next-line @backstage/no-undeclared-imports
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { alertApiRef } from '@backstage/core-plugin-api';
import { useLocation, useNavigationType } from 'react-router-dom';
import { localProvisionerApiRef } from '../../api/LocalProvisionerClient';
import type { TraineeActivityItem, TraineeListRow, TraineeRepoActivity, TraineeRow } from '../../api/types';
import { TraineesPage } from './TraineesPage';

/** Fixtures and a stand-in API for the Trainees page tests (not a test itself). */

// This file is type-checked with the app (test files are not), and jest's types are not loaded there: describe the little of jest it uses.
declare const jest: { fn: (impl?: (...args: any[]) => any) => any };
/** A jest mock function (`.mock.calls`, `.mockClear()`, `.mockRejectedValue()` ...). */
export type MockFn = any;
export const DAY = 86_400_000;
export const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

export const keyOf = (name: string) => `lab:agent-${name}::${name}`;

export function listRow(name: string, over: Partial<TraineeListRow> = {}): TraineeListRow {
  return {
    key: keyOf(name),
    traineeEmail: `${name}@example.com`,
    agentId: `agent-${name}`,
    resourceName: name,
    lab: 'terraform-capstone-a',
    taskType: 'provision-training',
    environment: { state: 'running', updatedAt: iso(2 * DAY), provisionedAt: iso(9 * DAY), agentOnline: true },
    repoUrl: `https://github.com/o/${name}`,
    hasGithubRepo: true,
    ...over,
  };
}

export function repoActivity(over: Partial<TraineeRepoActivity> = {}): TraineeRepoActivity {
  return {
    owner: 'o',
    repo: 'r',
    htmlUrl: 'https://github.com/o/r',
    empty: false,
    commitCount: 6,
    lastCommit: { sha: 'abcdef1234', message: 'feat: S3 upload script', date: iso(DAY), author: 'jane' },
    commitsPerDay: Array.from({ length: 14 }, (_, i) => ({ date: `2026-11-${String(i + 1).padStart(2, '0')}`, count: i === 13 ? 3 : 0 })),
    stageFilesWorked: ['CORRECTIONS', 'PROGRESS'],
    aiLogFiles: 2,
    corrections: 3,
    decisions: 1,
    progress: { done: 7, total: 10 },
    pullRequests: { open: 1, merged: 2 },
    ci: { status: 'completed', conclusion: 'success', updatedAt: iso(DAY), htmlUrl: 'https://github.com/o/r/actions/runs/1' },
    ...over,
  };
}

/** A detail row as the server sends it (no GitHub data in it). */
export function detailRow(name: string, over: Partial<TraineeRow> = {}): TraineeRow {
  const l = listRow(name);
  return { ...l, events: [{ type: 'provision-training', status: 'completed', at: iso(9 * DAY) }], checks: [], catalogEntityRef: `resource:default/${name}`, ...over } as TraineeRow;
}

export const item = (key: string, over: Partial<TraineeActivityItem> = {}): TraineeActivityItem => ({
  key,
  repoUrl: `https://github.com/o/${key.split('::')[1] ?? key}`,
  fetchedAt: new Date().toISOString(),
  code: 'ok',
  repo: repoActivity(),
  ...over,
});

export type ActivityFn = (keys: string[], level: 'brief' | 'full', refresh: boolean) => TraineeActivityItem[] | Promise<TraineeActivityItem[]>;

export interface KitOptions {
  rows: TraineeListRow[];
  /** Answers for getTraineeActivity; by default every key is ok with `repoActivity()`. */
  activity?: ActivityFn;
  detail?: (key: string) => TraineeRow | null | Promise<TraineeRow | null>;
  extra?: Record<string, MockFn>;
}

export function makeApi({ rows, activity, detail, extra = {} }: KitOptions) {
  const getTraineeList = jest.fn(async () => rows);
  const getTraineeActivity = jest.fn(async (keys: string[], level: 'brief' | 'full', refresh = false) => (activity ? activity(keys, level, refresh) : keys.map(k => item(k))));
  const getTraineeDetail = jest.fn(async (key: string) => (detail ? detail(key) : null));
  return { getTraineeList, getTraineeActivity, getTraineeDetail, ...extra } as Record<string, MockFn>;
}

/** Shows where the router is, and how it got there (PUSH adds a history step, REPLACE does not). */
function LocationProbe() {
  const l = useLocation();
  const nav = useNavigationType();
  return <div data-testid="location" data-nav={nav}>{`${l.pathname}${l.search}`}</div>;
}

export async function renderPage(api: Record<string, MockFn>, route = '/local-provisioner/trainees') {
  const post = jest.fn();
  await renderInTestApp(
    <TestApiProvider
      apis={[
        [localProvisionerApiRef, api as any],
        [alertApiRef, { post, alert$: () => ({ subscribe: () => ({ unsubscribe() {} }) }) } as any],
      ]}
    >
      <TraineesPage />
      <LocationProbe />
    </TestApiProvider>,
    { routeEntries: [route] },
  );
  const params = () => new URLSearchParams(document.querySelector('[data-testid="location"]')!.textContent!.split('?')[1] ?? '');
  const nav = () => document.querySelector('[data-testid="location"]')!.getAttribute('data-nav');
  return { post, params, nav };
}

/** A promise the test settles by hand. */
export function gate<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Many rows with a few known problems: t003 and t004 failed, t010 stuck, t020 offline for days. */
export function manyRows(n = 142): TraineeListRow[] {
  const rows: TraineeListRow[] = [];
  for (let i = 0; i < n; i++) {
    const name = `t${String(i).padStart(3, '0')}`;
    let over: Partial<TraineeListRow> = { lab: i % 3 === 0 ? 'nodejs-capstone-a' : 'terraform-capstone-a' };
    if (i === 3 || i === 4) over = { ...over, environment: { state: 'error', updatedAt: iso(DAY), agentOnline: true }, attention: { severity: 2, code: 'lab_failed', text: 'Lab failed' } };
    if (i === 10) over = { ...over, environment: { state: 'provisioning', updatedAt: iso(DAY), agentOnline: true, current: { type: 'provision-training', status: 'in-progress', step: 'Building app', since: iso(50 * 60_000) } }, attention: { severity: 1, code: 'stuck', text: 'Stuck for 50 min' } };
    if (i === 20) over = { ...over, environment: { state: 'running', updatedAt: iso(5 * DAY), agentOnline: false, agentLastSeen: iso(3 * DAY) }, attention: { severity: 1, code: 'agent_offline', text: 'Agent offline for 3 d' } };
    if (i % 7 === 0 && i > 20) over = { ...over, environment: { state: 'stopped', updatedAt: iso((i + 3) * 3_600_000), agentOnline: false } };
    else if (!over.environment) over = { ...over, environment: { state: 'running', updatedAt: iso((i + 3) * 3_600_000), provisionedAt: iso(9 * DAY), agentOnline: true } };
    rows.push(listRow(name, over));
  }
  return rows;
}
