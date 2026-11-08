import React from 'react';
import { fireEvent, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { TraineeListRow, TraineeRow } from '../../api/types';
import { DAY, detailRow, item, iso, listRow, makeApi, renderPage, repoActivity } from './testKit';

jest.setTimeout(40_000);

/**
 * Ronald about the side panel: "it sucks, hard to identify which is button or not, too crowded and confusing", and "we dont use
 * background colors in tabs". So: everything you can press is a real button (outlined, or filled for the main action) with its words;
 * states and problems are badges that cannot be mistaken for buttons; the sections are separate boxes; the tabs are the plain underline
 * tabs of every other page.
 */
const detail = (): TraineeRow =>
  detailRow('ann', {
    capstone: { id: 'e1', capstone: 'nodejs-b', traineeNo: '01', status: 'active', availableChecks: [{ name: 'grade', title: 'Grade' }] } as any,
    checks: [{ name: 'grade', status: 'completed', exitCode: 0, at: iso(DAY), output: '' } as any],
    attention: { severity: 2, code: 'lab_failed', text: 'Lab failed' },
  } as any);

async function open() {
  const d = detail();
  const { repo: _r, repoNote: _n, ...server } = d;
  const rows: TraineeListRow[] = [listRow('ann', { ...(d as any), hasGithubRepo: true })];
  const api = makeApi({ rows, detail: () => server as TraineeRow, activity: keys => keys.map(k => item(k, { repo: repoActivity() })) });
  await renderPage(api, `/local-provisioner/trainees?open=${encodeURIComponent(d.key)}`);
  const panel = await screen.findByLabelText('Trainee details');
  await within(panel).findByRole('tablist', undefined, { timeout: 8000 });
  return panel;
}

const classOf = (el: HTMLElement) => el.className;

describe('TraineePanel — a clear panel', () => {
  it('every button is an outlined or filled button with its words, never a bare text button', async () => {
    const panel = await open();
    for (const name of ['Report', 'Mark done', 'Remove trainee']) {
      const button = within(panel).getByRole('button', { name });
      expect(classOf(button)).toMatch(/MuiButton-(outlined|contained)\b/);
      expect(classOf(button)).not.toMatch(/MuiButton-text\b/);
      expect(button.textContent).toMatch(new RegExp(name));
    }
    // The main action is the filled one.
    expect(classOf(within(panel).getByRole('button', { name: 'Mark done' }))).toMatch(/MuiButton-contained\b/);
    expect(classOf(within(panel).getByRole('button', { name: 'Report' }))).toMatch(/MuiButton-outlined\b/);
    // The red one is marked destructive (the portal's own mark).
    expect(within(panel).getByRole('button', { name: 'Remove trainee' })).toHaveAttribute('data-destructive');
  });

  it('a state and a problem are badges, not buttons', async () => {
    const panel = await open();
    expect(within(panel).getByTestId('attention')).toHaveTextContent('Serious: Lab failed');
    expect(within(panel).queryByRole('button', { name: /Lab failed|running/ })).toBeNull();
    expect(within(panel).getByText('running').parentElement!.style.borderRadius).toBe('9999px');
  });

  it('the tabs are the plain tabs of every other page: no background colour on them', async () => {
    const panel = await open();
    const tablist = within(panel).getByRole('tablist');
    for (const el of [tablist, tablist.parentElement!, ...within(panel).getAllByRole('tab')]) {
      expect(el.getAttribute('style') ?? '').not.toMatch(/background/i);
    }
  });

  it('the Work tab is separate boxes with labelled rows, and its links are buttons', async () => {
    const panel = await open();
    await within(panel).findByText('Commits, last 14 days');
    for (const title of ['Commits, last 14 days', 'Progress', 'Stage files worked on']) expect(within(panel).getByText(title)).toBeInTheDocument();
    expect(within(panel).getByText('Tasks done').nextElementSibling).toHaveTextContent('7/10');
    const repoLink = within(panel).getByRole('link', { name: /Repository/ });
    expect(classOf(repoLink)).toMatch(/MuiButton-outlined\b/);
  });

  it('each check is one card: what it is and its latest result, then its Run and Details buttons', async () => {
    const panel = await open();
    fireEvent.click(within(panel).getByRole('tab', { name: 'Checks' }));
    const run = await within(panel).findByRole('button', { name: 'Run Grade' });
    const details = within(panel).getByRole('button', { name: 'Details of Grade' });
    expect(classOf(run)).toMatch(/MuiButton-outlined\b/);
    expect(classOf(details)).toMatch(/MuiButton-outlined\b/);
    expect(run.closest('div')!.parentElement).toBe(details.closest('div')!.parentElement); // the same card
    expect(within(panel).getByText('Grade')).toBeInTheDocument();
  });

  it('the Danger zone has a gap above it on every tab, also after a row of link buttons', async () => {
    const panel = await open();
    await within(panel).findByText('Commits, last 14 days');
    const zone = () => within(panel).getByText('Danger zone').closest('div')!.parentElement as HTMLElement;
    // Work ends with the link buttons (Repository, Latest CI run): they used to touch the box.
    expect(within(panel).getByRole('link', { name: /Repository/ }).parentElement!.parentElement!.nextElementSibling).toBe(zone()); // links row -> tab panel -> the box
    for (const tab of ['Work', 'Checks', 'Capstone', 'History']) {
      fireEvent.click(within(panel).getByRole('tab', { name: tab }));
      expect(parseFloat(getComputedStyle(zone()).marginTop)).toBeGreaterThanOrEqual(16);
    }
  });

  it('removing a trainee is kept apart in a "Danger zone" at the bottom', async () => {
    const panel = await open();
    const zone = within(panel).getByText('Danger zone').closest('div')!.parentElement as HTMLElement;
    expect(within(zone).getByRole('button', { name: 'Remove trainee' })).toBeInTheDocument();
    expect(within(zone).queryByRole('button', { name: 'Report' })).toBeNull();
  });
});
