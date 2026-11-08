import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { checkSummary, relativeTime } from './TraineesPage';
import { DAY, gate, iso, item, keyOf, listRow, makeApi, manyRows, renderPage, repoActivity } from './testKit';

jest.setTimeout(40_000);

/** The trainees on screen, in order (the e-mail is the first line of each row's first cell). */
const emailsOnScreen = () => screen.queryAllByText(/^[a-z0-9]+@example\.com$/).map(e => e.textContent);
const rowOf = (name: string) => screen.getByText(`${name}@example.com`).closest('tr') as HTMLElement;
/** Ordering re-draws the whole table; in jsdom that takes a moment. */
const inOrder = (expected: string[]) => waitFor(() => expect(emailsOnScreen()).toEqual(expected), { timeout: 8000 });
const sortBy = (header: string) => fireEvent.click(within(screen.getAllByRole('columnheader').find(h => h.textContent === header)!).getByText(header));

describe('TraineesPage — the list', () => {
  it('is the portal’s own table: a title with counts, the stock search, every column as a header, 10 rows a page (10, 25 or 50, like User Management)', async () => {
    await renderPage(makeApi({ rows: manyRows(142) }));
    expect(await screen.findByText('142 trainees · 4 need attention')).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Trainee', 'Attention', 'Lab', 'Progress', 'Last commit', '14 days', 'CI', '']);
    expect(screen.getByPlaceholderText('Filter')).toBeInTheDocument();
    expect(emailsOnScreen()).toHaveLength(10);
    expect(screen.getByRole('tab', { name: 'Active (142)' })).toHaveAttribute('aria-selected', 'true');
  });

  it('a short list is not padded to a full page: no blank filler row between the last trainee and the pager', async () => {
    await renderPage(makeApi({ rows: manyRows(8) }));
    await screen.findByText('8 trainees · 2 need attention');
    const bodyRows = Array.from(document.querySelectorAll('tbody tr'));
    expect(bodyRows).toHaveLength(8); // the table adds one tall empty row to fill a page unless told not to
    expect(bodyRows.every(r => r.textContent!.includes('@example.com'))).toBe(true);
  });

  it('puts the most serious first and asks GitHub only for the rows on screen', async () => {
    const api = makeApi({ rows: manyRows(142) });
    await renderPage(api);
    await screen.findByText('142 trainees · 4 need attention');
    expect(emailsOnScreen().slice(0, 2).sort()).toEqual(['t003@example.com', 't004@example.com']); // lab failed
    expect(emailsOnScreen().slice(2, 4)).toEqual(['t010@example.com', 't020@example.com']); // stuck, then agent offline: warnings
    await waitFor(() => expect(screen.getAllByText('7/10')).toHaveLength(10));
    const asked = new Set(api.getTraineeActivity.mock.calls.flatMap(c => c[0] as string[]));
    expect(asked.size).toBe(10);
    expect(asked.has(keyOf('t141'))).toBe(false);
    expect(api.getTraineeActivity.mock.calls.every(c => c[1] === 'brief')).toBe(true);
    expect(api.getTraineeDetail).not.toHaveBeenCalled();
  });

  it('shows grey bars where GitHub data is still coming, then the values, and no row moves meanwhile', async () => {
    const hold = gate<void>();
    const api = makeApi({
      rows: manyRows(10),
      activity: async keys => {
        await hold.promise;
        return keys.map(k => item(k));
      },
    });
    await renderPage(api);
    await screen.findByText('10 trainees · 2 need attention');
    const before = emailsOnScreen();
    expect(screen.getAllByRole('img', { name: 'loading' }).length).toBeGreaterThan(0);
    expect(screen.getByText('GitHub activity 0 of 10')).toBeInTheDocument();
    hold.resolve();
    await waitFor(() => expect(screen.getAllByText('7/10')).toHaveLength(10));
    expect(emailsOnScreen()).toEqual(before);
    expect(screen.getByText('GitHub activity 10 of 10')).toBeInTheDocument();
  });

  it('a row stays the same row on screen while GitHub data arrives (it is not drawn from scratch)', async () => {
    const hold = gate<void>();
    const api = makeApi({
      rows: manyRows(10),
      activity: async keys => {
        await hold.promise;
        return keys.map(k => item(k));
      },
    });
    await renderPage(api);
    await screen.findByText('10 trainees · 2 need attention');
    const row = rowOf('t003');
    const cell = within(row).getByText('t003@example.com');
    hold.resolve();
    await waitFor(() => expect(screen.getAllByText('7/10')).toHaveLength(10));
    // Reloading the list changes what the table is given (a trainee more: its title says 11). React must keep the row it has: the table
    // draws every row from scratch when one of its props gets a new identity (the empty-state element, say), and then every cell asks
    // GitHub again.
    api.getTraineeList.mockImplementation(async () => manyRows(11));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(api.getTraineeList).toHaveBeenCalledTimes(2));
    await screen.findByText('11 trainees · 3 need attention', undefined, { timeout: 8000 });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled(), { timeout: 8000 });
    expect(row.isConnected).toBe(true);
    expect(cell.isConnected).toBe(true);
    expect(rowOf('t003')).toBe(row);
  });

  it('a database reason is shown from the start, with its severity in words', async () => {
    await renderPage(makeApi({ rows: manyRows(30) }));
    await screen.findByText('30 trainees · 4 need attention');
    expect(within(rowOf('t003')).getByTestId('attention')).toHaveTextContent('Serious: Lab failed');
    expect(within(rowOf('t010')).getByTestId('attention')).toHaveTextContent('Warning: Stuck for 50 min');
  });

  it('a state, a CI result and a problem are the portal’s badges (tinted pills), not buttons', async () => {
    const rows = [
      listRow('good'),
      listRow('bad', { environment: { state: 'error', updatedAt: iso(0), agentOnline: true }, attention: { severity: 2, code: 'lab_failed', text: 'Lab failed' } }),
      listRow('off', { environment: { state: 'stopped', updatedAt: iso(0), agentOnline: false } }),
    ];
    const ci = (conclusion: string) => repoActivity({ ci: { status: 'completed', conclusion, updatedAt: iso(0), htmlUrl: 'x' } });
    await renderPage(makeApi({ rows, activity: keys => keys.map(k => item(k, { repo: ci(k.includes('::bad') ? 'failure' : 'success') })) }));
    await waitFor(() => expect(screen.getAllByText('passing').length).toBeGreaterThan(0));
    // The words are in an inner span; the badge is its parent.
    const badgeOf = (name: string, text: string) => within(rowOf(name)).getByText(text).parentElement as HTMLElement;
    expect(badgeOf('good', 'running').style.borderRadius).toBe('9999px');
    expect(badgeOf('bad', 'failed')).toBeInTheDocument();
    expect(badgeOf('off', 'stopped')).toBeInTheDocument();
    expect(badgeOf('good', 'passing')).toBeInTheDocument();
    expect(badgeOf('bad', 'failure')).toBeInTheDocument();
    expect(within(rowOf('good')).queryByRole('button', { name: 'running' })).toBeNull();
  });

  it('search is the table’s own and looks at the trainee, the course and the lab’s state as words', async () => {
    await renderPage(makeApi({ rows: manyRows(60) }));
    await screen.findByText('60 trainees · 4 need attention');
    const box = screen.getByPlaceholderText('Filter');
    fireEvent.change(box, { target: { value: 't01' } });
    await waitFor(() => {
      expect(emailsOnScreen()).toHaveLength(10);
      expect(emailsOnScreen().every(e => e!.startsWith('t01'))).toBe(true);
    });
    fireEvent.change(box, { target: { value: 'failed' } }); // the lab state, as a word
    await waitFor(() => expect(emailsOnScreen().sort()).toEqual(['t003@example.com', 't004@example.com']));
    fireEvent.change(box, { target: { value: 'nodejs' } });
    await waitFor(() => expect(emailsOnScreen()).toHaveLength(10)); // 20 of the 60 are Node.js (every third); the first page shows 10
    fireEvent.change(box, { target: { value: 'zzz-nobody' } });
    expect(await screen.findByText('No records to display')).toBeInTheDocument();
  });

  it('the page size is 10, 25 or 50, as in User Management', async () => {
    await renderPage(makeApi({ rows: manyRows(60) }));
    await screen.findByText('60 trainees · 4 need attention');
    expect(emailsOnScreen()).toHaveLength(10);
    fireEvent.mouseDown(screen.getByRole('button', { name: /rows/i }));
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['10', '25', '50']);
    fireEvent.click(screen.getByRole('option', { name: '25' }));
    await waitFor(() => expect(emailsOnScreen()).toHaveLength(25), { timeout: 8000 });
  });

  it('pages with the table’s own footer, and a new page asks GitHub for its own rows', async () => {
    const api = makeApi({ rows: manyRows(60) });
    await renderPage(api);
    await waitFor(() => expect(screen.getAllByText('7/10')).toHaveLength(10));
    api.getTraineeActivity.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    await waitFor(() => expect(screen.getAllByText('7/10')).toHaveLength(10));
    const asked = api.getTraineeActivity.mock.calls.flatMap(c => c[0] as string[]);
    expect(new Set(asked).size).toBe(10);
    expect(asked.includes(keyOf('t003'))).toBe(false); // that row was on the first page
  });
});

describe('TraineesPage — every column sorts from its header', () => {
  it('Trainee and Lab: from the portal’s own data, at once; the next click keeps the direction, the third click goes back to the default', async () => {
    const rows = [
      listRow('ccc', { environment: { state: 'running', updatedAt: iso(3 * DAY), agentOnline: true } }),
      listRow('aaa', { environment: { state: 'stopped', updatedAt: iso(2 * DAY), agentOnline: false } }),
      listRow('bbb', { environment: { state: 'error', updatedAt: iso(DAY), agentOnline: true }, attention: { severity: 2, code: 'lab_failed', text: 'Lab failed' } }),
    ];
    await renderPage(makeApi({ rows }));
    await screen.findByText('3 trainees · 1 need attention');
    expect(emailsOnScreen()).toEqual(['bbb@example.com', 'aaa@example.com', 'ccc@example.com']); // attention, then the newest change
    sortBy('Trainee');
    await inOrder(['aaa@example.com', 'bbb@example.com', 'ccc@example.com']);
    sortBy('Trainee');
    await inOrder(['ccc@example.com', 'bbb@example.com', 'aaa@example.com']);
    sortBy('Lab'); // another column keeps the direction (the table's own rule): descending, so the stopped lab first
    await inOrder(['aaa@example.com', 'ccc@example.com', 'bbb@example.com']);
    sortBy('Lab'); // third click: no order of its own, so the default again
    await inOrder(['bbb@example.com', 'aaa@example.com', 'ccc@example.com']);
    sortBy('Attention'); // the default column is the order now: this click turns it round
    await inOrder(['ccc@example.com', 'aaa@example.com', 'bbb@example.com']);
  });

  it('Progress: loads everyone first, keeps the list as it is meanwhile, then orders it once (and keeps it, also turned round)', async () => {
    const hold = gate<void>();
    const progress: Record<string, number> = { aaa: 9, bbb: 2, ccc: 5 };
    const api = makeApi({
      rows: [listRow('aaa'), listRow('bbb'), listRow('ccc')],
      activity: async keys => {
        await hold.promise;
        return keys.map(k => item(k, { repo: repoActivity({ progress: { done: progress[k.split('::')[1]], total: 10 } }) }));
      },
    });
    await renderPage(api);
    await screen.findByText('3 trainees · 0 need attention');
    const before = emailsOnScreen();
    sortBy('Progress');
    expect(await screen.findByText(/Loading GitHub data for \d+ more trainees/)).toBeInTheDocument();
    expect(emailsOnScreen()).toEqual(before);
    sortBy('Progress'); // turned round while it is still loading: nothing moves yet either
    await waitFor(() => expect(emailsOnScreen()).toEqual(before));
    hold.resolve();
    // Descending, the furthest on first. The table puts its default column back when the data changes under another order: it must not.
    await inOrder(['aaa@example.com', 'ccc@example.com', 'bbb@example.com']);
    sortBy('Progress'); // the third click: no order of its own, so the default again
    await inOrder(before as string[]);
  });

  it('a GitHub column asks for every trainee, not only the page on screen, before it orders', async () => {
    const api = makeApi({ rows: manyRows(60) });
    await renderPage(api);
    await waitFor(() => expect(screen.getAllByText('7/10')).toHaveLength(10));
    expect(api.getTraineeActivity.mock.calls.flatMap(c => c[0] as string[])).not.toContain(keyOf('t059'));
    sortBy('Last commit');
    await waitFor(() => expect(api.getTraineeActivity.mock.calls.flatMap(c => c[0] as string[])).toContain(keyOf('t059')), { timeout: 8000 });
    // The portal's own columns do not ask for anything more, once everything has loaded.
    await screen.findByText('GitHub activity 60 of 60', undefined, { timeout: 15000 });
    api.getTraineeActivity.mockClear();
    sortBy('Trainee');
    await waitFor(() => expect(emailsOnScreen()[0]).toBe('t000@example.com'), { timeout: 8000 });
    expect(api.getTraineeActivity).not.toHaveBeenCalled();
  });

  it('Last commit, 14 days and CI sort too, from the loaded data', async () => {
    const at = (days: number) => ({ sha: 'a', message: 'm', date: iso(days * DAY), author: 'x' });
    const spread = (n: number) => Array.from({ length: 14 }, (_, i) => ({ date: `2026-11-${String(i + 1).padStart(2, '0')}`, count: i === 13 ? n : 0 }));
    const data: Record<string, any> = {
      aaa: { lastCommit: at(1), commitsPerDay: spread(9), ci: { status: 'completed', conclusion: 'success', updatedAt: iso(0), htmlUrl: 'x' } },
      bbb: { lastCommit: at(8), commitsPerDay: spread(1), ci: { status: 'completed', conclusion: 'failure', updatedAt: iso(0), htmlUrl: 'x' } },
      ccc: { lastCommit: at(4), commitsPerDay: spread(4), ci: { status: 'in_progress', updatedAt: iso(0), htmlUrl: 'x' } },
    };
    await renderPage(makeApi({ rows: [listRow('aaa'), listRow('bbb'), listRow('ccc')], activity: keys => keys.map(k => item(k, { repo: repoActivity(data[k.split('::')[1]]) })) }));
    await waitFor(() => expect(screen.getAllByText(/passing|failure/).length).toBe(2), { timeout: 5000 }); // all three are loaded: two finished runs and one running
    sortBy('Last commit'); // the oldest first
    await inOrder(['bbb@example.com', 'ccc@example.com', 'aaa@example.com']);
    sortBy('14 days'); // another column keeps the direction: the fewest first
    await inOrder(['bbb@example.com', 'ccc@example.com', 'aaa@example.com']);
    sortBy('14 days');
    await inOrder(['aaa@example.com', 'ccc@example.com', 'bbb@example.com']);
    sortBy('CI'); // descending now: passing, running, failing
    await inOrder(['aaa@example.com', 'ccc@example.com', 'bbb@example.com']);
    sortBy('CI');
    await inOrder(['aaa@example.com', 'bbb@example.com', 'ccc@example.com']); // the third click: the default order (all three are equal: by key)
  });
});

describe('TraineesPage — refresh, errors and limits', () => {
  it('Refresh reloads the list and the GitHub data of the rows on screen, once', async () => {
    const gateList = gate<void>();
    const api = makeApi({ rows: manyRows(60) });
    await renderPage(api);
    await waitFor(() => expect(screen.getAllByText('7/10')).toHaveLength(10));
    api.getTraineeActivity.mockClear();
    api.getTraineeList.mockImplementation(async () => {
      await gateList.promise;
      return manyRows(60);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' })); // ignored while it works
    expect(api.getTraineeList).toHaveBeenCalledTimes(2);
    gateList.resolve();
    await waitFor(() => expect(api.getTraineeActivity).toHaveBeenCalled());
    const refreshed = api.getTraineeActivity.mock.calls.filter(c => c[2] === true).flatMap(c => c[0] as string[]);
    expect(new Set(refreshed).size).toBe(10);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled());
  });

  it('keeps the rows on screen while it reloads, and when the reload fails says so next to them', async () => {
    const api = makeApi({ rows: manyRows(10) });
    await renderPage(api);
    await screen.findByText('10 trainees · 2 need attention');
    await waitFor(() => expect(screen.getAllByText('7/10')).toHaveLength(10));
    api.getTraineeList.mockRejectedValueOnce(Object.assign(new Error('Failed to load trainees: Bad Gateway'), { status: 502 }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Failed to load trainees: Bad Gateway')).toBeInTheDocument();
    expect(emailsOnScreen()).toHaveLength(10);
  });

  it('tells non-instructors the view is not for them on 403', async () => {
    const api = makeApi({ rows: [] });
    api.getTraineeList.mockRejectedValue(Object.assign(new Error('Access denied'), { status: 403 }));
    await renderPage(api);
    expect(await screen.findByText('The Trainees view is for instructors and admins.')).toBeInTheDocument();
  });

  it('shows an error when the list cannot be loaded at all', async () => {
    const api = makeApi({ rows: [] });
    api.getTraineeList.mockRejectedValue(new Error('Failed to load trainees: Internal Server Error'));
    await renderPage(api);
    expect(await screen.findByText('Failed to load trainees: Internal Server Error')).toBeInTheDocument();
  });

  it('empty states: nobody yet, and everyone archived', async () => {
    await renderPage(makeApi({ rows: [] }));
    expect(await screen.findByText('No one has provisioned a training lab yet.')).toBeInTheDocument();
  });

  it('when everyone is archived the Active list points to the Archive', async () => {
    const { params } = await renderPage(makeApi({ rows: [listRow('done', { capstone: { id: 'e1', capstone: 'nodejs-b', traineeNo: '01', status: 'completed' } })] }));
    expect(await screen.findByText('No active trainees. Capstones marked done are in the Archive.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open the Archive' }));
    await waitFor(() => expect(params().get('tab')).toBe('archive'));
  });

  it('when GitHub says slow down, the page says so and sends nothing more for a while', async () => {
    const api = makeApi({ rows: manyRows(30), activity: keys => keys.map(k => item(k, { code: 'rate_limited', repo: undefined })) });
    await renderPage(api);
    expect(await screen.findByText(/GitHub is limiting requests\. Trying again in \d+ s\./)).toBeInTheDocument();
    const calls = api.getTraineeActivity.mock.calls.length;
    await new Promise(r => setTimeout(r, 150));
    expect(api.getTraineeActivity.mock.calls.length).toBe(calls);
    expect(screen.getAllByRole('img', { name: 'loading' }).length).toBeGreaterThan(0); // the cells still wait, they do not turn into errors
  });

  it('a whole GitHub request that fails leaves the rows "not available" and the page usable', async () => {
    const api = makeApi({ rows: manyRows(5) });
    api.getTraineeActivity.mockRejectedValue(new Error('Failed to load GitHub activity: Bad Gateway'));
    await renderPage(api);
    await screen.findByText('5 trainees · 2 need attention');
    await waitFor(() => expect(screen.getAllByText('not available')).toHaveLength(5), { timeout: 5000 });
    expect(emailsOnScreen()).toHaveLength(5);
  });
});

describe('TraineesPage — opening a trainee and the two views', () => {
  it('clicking a row, or its arrow, adds a step to the address with its key; closing takes it away', async () => {
    const api = makeApi({ rows: [listRow('aaa'), listRow('bbb')], detail: key => ({ ...(listRow(key.split('::')[1]) as any), events: [], checks: [] }) });
    const { params, nav } = await renderPage(api);
    await screen.findByText('2 trainees · 0 need attention');
    fireEvent.click(screen.getByText('aaa@example.com'));
    await waitFor(() => expect(params().get('open')).toBe(keyOf('aaa')));
    expect(nav()).toBe('PUSH');
    expect(api.getTraineeDetail).toHaveBeenCalledWith(keyOf('aaa'));
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    await waitFor(() => expect(params().get('open')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Open bbb@example.com' }));
    await waitFor(() => expect(params().get('open')).toBe(keyOf('bbb')));
  });

  it('an address with a trainee in it opens that trainee, and Active / Archive are tabs in the address', async () => {
    const rows = [listRow('aaa'), listRow('arch', { capstone: { id: 'e1', capstone: 'nodejs-b', traineeNo: '01', status: 'completed' } })];
    const api = makeApi({ rows, detail: key => ({ ...(rows.find(r => r.key === key) as any), events: [], checks: [] }) });
    const { params, nav } = await renderPage(api, `/local-provisioner/trainees?open=${encodeURIComponent(keyOf('aaa'))}`);
    expect(await screen.findByRole('tabpanel', undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(api.getTraineeDetail).toHaveBeenCalledWith(keyOf('aaa'));
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    await waitFor(() => expect(params().get('open')).toBeNull());
    expect(screen.getByRole('tab', { name: 'Archive (1)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Archive (1)' }));
    await waitFor(() => expect(params().get('tab')).toBe('archive'));
    expect(nav()).toBe('REPLACE');
  });
});

describe('the small helpers the page exports', () => {
  it('relativeTime', () => {
    const now = new Date('2026-11-07T12:00:00Z');
    expect(relativeTime('2026-11-07T11:59:30Z', now)).toBe('just now');
    expect(relativeTime('2026-11-07T11:00:00Z', now)).toBe('1h ago');
    expect(relativeTime('2026-11-05T12:00:00Z', now)).toBe('2d ago');
    expect(relativeTime(undefined, now)).toBe('—');
  });

  it('checkSummary says what a result means', () => {
    expect(typeof checkSummary).toBe('function');
  });
});
