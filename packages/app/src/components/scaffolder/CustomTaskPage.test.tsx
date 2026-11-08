import React, { useState } from 'react';
import { act, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Navigate, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { alertApiRef } from '@backstage/core-plugin-api';
import { scaffolderApiRef, useTaskEventStream } from '@backstage/plugin-scaffolder-react';
import { CustomTaskPage } from './CustomTaskPage';
import { LAB_REDIRECT_WINDOW_MS, newRunState } from './labRedirect';

jest.setTimeout(30000);

// The event stream is the scaffolder's own hook (an SSE connection); each test hands the page the
// stream it wants. The log view measures its parent, which jsdom cannot, so it is replaced.
jest.mock('@backstage/plugin-scaffolder-react', () => ({
  ...jest.requireActual('@backstage/plugin-scaffolder-react'),
  useTaskEventStream: jest.fn(),
}));
jest.mock('@backstage/plugin-scaffolder-react/alpha', () => ({
  ...jest.requireActual('@backstage/plugin-scaffolder-react/alpha'),
  TaskLogStream: () => <div>log</div>,
}));
jest.mock('@backstage/plugin-permission-react', () => ({
  ...jest.requireActual('@backstage/plugin-permission-react'),
  usePermission: () => ({ allowed: true, loading: false }),
}));

const mockedStream = useTaskEventStream as jest.Mock;

const LAB_ID = '3f2b8c1e-5a7d-4e90-9b1c-0d4e6f8a1b2c';
const LAB_URL = `/local-provisioner/tasks/${LAB_ID}`;
const repoLink = { title: 'Your Capstone Repo', icon: 'github', url: 'https://github.com/example-org/some-repo' };
const labLink = { title: 'Your Lab', icon: 'dashboard', url: LAB_URL };

/** The stream the scaffolder hook returns. A finished, successful run unless a test says otherwise. */
function stream(over: Record<string, unknown> = {}) {
  return {
    loading: false,
    completed: true,
    cancelled: false,
    error: undefined,
    output: { links: [repoLink, labLink] },
    stepLogs: {},
    steps: {
      'check-agent': { id: 'check-agent', status: 'completed' },
      'queue-task': { id: 'queue-task', status: 'completed' },
    },
    task: {
      spec: {
        steps: [
          { id: 'check-agent', name: 'Check your agent' },
          { id: 'queue-task', name: 'Queue the lab' },
        ],
        templateInfo: { entity: { metadata: { name: 'linux-capstone-a-training-local' } } },
      },
    },
    ...over,
  };
}

/** Where the redirect lands, and how it got there. */
const LabProbe = () => {
  const { pathname, state } = useLocation();
  const type = useNavigationType();
  return (
    <div>
      <span data-testid="lab-path">{pathname}</span>
      <span data-testid="lab-nav">{type}</span>
      <span data-testid="lab-state">{JSON.stringify(state)}</span>
    </div>
  );
};

let setStream: (s: any) => void;
/** Holds the stream in state so a test can change it while the page is open. */
const Harness = ({ initial }: { initial: any }) => {
  const [s, setS] = useState(initial);
  setStream = setS;
  mockedStream.mockReturnValue(s);
  return <CustomTaskPage />;
};

/** The run was started by this user just now, as the wizard marks it. */
const JUST_STARTED = Symbol('just started');
/** The run was opened some other way and carries no navigation state at all. */
const NO_MARK = Symbol('no mark');

async function openRun(initial: any, mark: unknown = JUST_STARTED) {
  let state = mark;
  if (mark === JUST_STARTED) state = newRunState();
  else if (mark === NO_MARK) state = undefined;
  const alerts: any[] = [];
  const alertApi: any = { post: (a: any) => alerts.push(a), alert$: () => ({ subscribe: () => ({ unsubscribe() {} }) }) };
  const scaffolder: any = { cancelTask: jest.fn() };
  await renderInTestApp(
    <TestApiProvider apis={[[scaffolderApiRef, scaffolder], [alertApiRef, alertApi]]}>
      <Routes>
        <Route path="/start" element={<Navigate to="/create/tasks/run-1" state={state} replace />} />
        <Route path="/create/tasks/:taskId" element={<Harness initial={initial} />} />
        <Route path="/local-provisioner/*" element={<LabProbe />} />
      </Routes>
    </TestApiProvider>,
    { routeEntries: ['/start'] },
  );
  return { alerts };
}

const stayed = () => expect(screen.getByText(/Creating linux-capstone-a-training-local/)).toBeInTheDocument();

describe('CustomTaskPage: after a run you just started', () => {
  it('sends you to your lab when the run succeeds, replacing the run page, and marks the arrival', async () => {
    const { alerts } = await openRun(stream());
    expect(await screen.findByTestId('lab-path')).toHaveTextContent(LAB_URL);
    // replace: Back does not return to a finished run page that would only bounce forward again.
    expect(screen.getByTestId('lab-nav')).toHaveTextContent('REPLACE');
    // The lab page greets the new lab itself (the invitation reminder) when it sees this mark; this page
    // does not post a toast of its own, which would be gone with the page.
    expect(JSON.parse(screen.getByTestId('lab-state').textContent!)).toEqual({ labJustCreated: true });
    expect(alerts).toHaveLength(0);
  });

  it('waits while the run is still going, then goes when it succeeds', async () => {
    await openRun(stream({ completed: false, output: undefined, steps: { 'check-agent': { id: 'check-agent', status: 'completed' }, 'queue-task': { id: 'queue-task', status: 'processing' } } }));
    stayed();
    expect(screen.queryByTestId('lab-path')).not.toBeInTheDocument();
    await act(async () => {
      setStream(stream());
    });
    expect(await screen.findByTestId('lab-path')).toHaveTextContent(LAB_URL);
  });

  it('finds the lab link among the other links', async () => {
    await openRun(stream({ output: { links: [repoLink, { title: 'Docs', url: 'https://example.com/docs' }, labLink] } }));
    expect(await screen.findByTestId('lab-path')).toHaveTextContent(LAB_URL);
  });

  it('goes to the lab by its canonical (lowercase) path', async () => {
    await openRun(stream({ output: { links: [{ title: 'Your Lab', url: `/local-provisioner/tasks/${LAB_ID.toUpperCase()}` }] } }));
    expect(await screen.findByTestId('lab-path')).toHaveTextContent(LAB_URL);
  });

  it.each([
    ['failed', { error: { name: 'Error', message: 'publish failed' }, output: undefined }],
    ['failed but still carrying a lab link', { error: { name: 'Error', message: 'a later step failed' } }],
    ['lost its connection', { error: new Error('We cannot connect at the moment'), completed: true }],
    ['was cancelled', { cancelled: true, completed: false, output: undefined }],
    ['was cancelled after completing', { cancelled: true }],
    ['has a failed step but no error on the run', { steps: { 'check-agent': { id: 'check-agent', status: 'completed' }, 'queue-task': { id: 'queue-task', status: 'failed' } } }],
    ['lost its heartbeat (completed with no error and no output)', { output: undefined }],
    ['has no links', { output: {} }],
    ['has links but none to a lab', { output: { links: [repoLink] } }],
    ['links to a lab on another site', { output: { links: [{ title: 'Your Lab', url: `https://evil.example${LAB_URL}` }] } }],
    ['links to a lab with a protocol-relative URL', { output: { links: [{ title: 'Your Lab', url: `//evil.example${LAB_URL}` }] } }],
    ['links to a lab with extra path or query', { output: { links: [{ title: 'Your Lab', url: `${LAB_URL}/../trainees` }, { title: 'Your Lab', url: `${LAB_URL}?x=1` }] } }],
    ['has a link with no url (a catalog entity link)', { output: { links: [{ title: 'Entity', entityRef: 'component:default/x' }] } }],
  ])('stays on the run page when the run %s', async (_name, over) => {
    const { alerts } = await openRun(stream(over));
    stayed();
    expect(screen.queryByTestId('lab-path')).not.toBeInTheDocument();
    expect(alerts).toHaveLength(0);
  });
});

describe('CustomTaskPage: a run you did not just start', () => {
  it.each([
    ['opened from a list or an old link (no mark)', NO_MARK],
    ['marked by something else', { somethingElse: true }],
    ['marked with a non-number', { labRedirectAt: 'now' }],
    ['marked with NaN', { labRedirectAt: Number.NaN }],
    ['marked more than 30 minutes ago', { labRedirectAt: Date.now() - LAB_REDIRECT_WINDOW_MS - 60_000 }],
    ['marked in the future', { labRedirectAt: Date.now() + 5 * 60_000 }],
  ])('is never redirected: %s', async (_name, state) => {
    const { alerts } = await openRun(stream(), state);
    stayed();
    expect(screen.queryByTestId('lab-path')).not.toBeInTheDocument();
    expect(alerts).toHaveLength(0);
  });

  it('still redirects a mark that is just inside the 30 minutes', async () => {
    await openRun(stream(), { labRedirectAt: Date.now() - LAB_REDIRECT_WINDOW_MS + 60_000 });
    expect(await screen.findByTestId('lab-path')).toHaveTextContent(LAB_URL);
  });
});
