import React from 'react';
import { screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Route, Routes } from 'react-router-dom';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import { TemplateOverviewField, buildOverview, TemplateOverviewOptions } from './TemplateOverviewField';

const entity = (over: { description?: string; tags?: string[]; steps?: any[] } = {}): any => ({
  apiVersion: 'scaffolder.backstage.io/v1beta3',
  kind: 'Template',
  metadata: { name: 'terraform-capstone-a-training-local', description: over.description ?? 'Build a thing. Then another thing.', tags: over.tags ?? ['training', 'terraform'] },
  spec: {
    steps: over.steps ?? [
      { id: 'check-agent', action: 'stratpoint:local-agent-check', input: { minAgentVersion: '0.1.23', requirements: { minDockerMemoryGb: 4 } } },
      { id: 'queue-task', action: 'stratpoint:local-provision' },
    ],
  },
});

const authored: TemplateOverviewOptions = {
  format: '5 days, solo',
  runsOn: 'Your laptop, on your own local MiniStack',
  gradedBy: 'Hidden checks, and by how you worked.',
  listTitle: 'What you will do',
  list: ['Three environments from one module', 'A change request mid-week'],
  onCreate: ['Your private capstone repository is created on GitHub.', 'The lab starts on your laptop.'],
};

describe('buildOverview', () => {
  it('takes "You need" from the template\'s own agent-check step, so it cannot drift', () => {
    const m = buildOverview(authored, entity());
    expect(m.facts.find(f => f.label === 'You need')?.value).toBe('Backstage agent 0.1.23 or newer, online. Docker with at least 4 GB of memory.');
  });

  it('says only what the check step requires', () => {
    const noVersion = entity({ steps: [{ action: 'stratpoint:local-agent-check', input: { requirements: { minDockerMemoryGb: 1 } } }, { action: 'stratpoint:local-provision' }] });
    expect(buildOverview({}, noVersion).facts.find(f => f.label === 'You need')?.value).toBe('Backstage agent, online. Docker with at least 1 GB of memory.');
    const noMemory = entity({ steps: [{ action: 'stratpoint:local-agent-check', input: { minAgentVersion: '0.1.23' } }, { action: 'stratpoint:local-provision' }] });
    expect(buildOverview({}, noMemory).facts.find(f => f.label === 'You need')?.value).toBe('Backstage agent 0.1.23 or newer, online.');
  });

  it('adds what the author says the lab also needs', () => {
    const m = buildOverview({ alsoNeed: 'Multipass (the agent tells you how to install it)' }, entity());
    expect(m.facts.find(f => f.label === 'You need')?.value).toBe(
      'Backstage agent 0.1.23 or newer, online. Docker with at least 4 GB of memory. Multipass (the agent tells you how to install it).',
    );
  });

  it('orders the facts Format, Runs on, You need, Graded by and leaves out what is not given', () => {
    expect(buildOverview(authored, entity()).facts.map(f => f.label)).toEqual(['Format', 'Runs on', 'You need', 'Graded by']);
    expect(buildOverview({ format: '5 days, solo' }, entity()).facts.map(f => f.label)).toEqual(['Format', 'Runs on', 'You need']);
  });

  it('puts the agent check first in what happens on Create, then the authored steps', () => {
    expect(buildOverview(authored, entity()).onCreate).toEqual([
      'Your Backstage agent is checked.',
      'Your private capstone repository is created on GitHub.',
      'The lab starts on your laptop.',
    ]);
  });

  it('with nothing authored falls back to the template description, and still has requirements and tags', () => {
    const m = buildOverview(undefined, entity({ description: 'Run a database on your laptop.' }));
    expect(m.summary).toBe('Run a database on your laptop.');
    expect(m.facts.map(f => f.label)).toEqual(['Runs on', 'You need']);
    expect(m.onCreate).toEqual(['Your Backstage agent is checked.']);
    expect(m.tags).toEqual(['training', 'terraform']);
  });

  it('keeps the description when the author wrote only what Create does', () => {
    const m = buildOverview({ onCreate: ['The database starts on your laptop.'] }, entity({ description: 'Run a database.' }));
    expect(m.summary).toBe('Run a database.');
  });

  it('does not repeat the description when the author wrote their own text', () => {
    expect(buildOverview(authored, entity()).summary).toBeUndefined();
    expect(buildOverview({ summary: 'Take over a broken API.' }, entity()).summary).toBe('Take over a broken API.');
  });

  it('calls the list "What you get" unless the author names it', () => {
    expect(buildOverview({ list: ['a'] }, entity()).listTitle).toBe('What you get');
    expect(buildOverview({ list: ['a'], listTitle: 'What you will build' }, entity()).listTitle).toBe('What you will build');
  });

  it('works for a template that is not a lab: no agent, no laptop, just what it says', () => {
    const service = entity({ steps: [{ action: 'publish:github' }], description: 'Create a service.' });
    const m = buildOverview({ onCreate: ['A repository is created.'] }, service);
    expect(m.facts).toEqual([]);
    expect(m.onCreate).toEqual(['A repository is created.']);
  });

  it('survives a template that could not be read, and malformed options', () => {
    const m = buildOverview({ list: ['ok', 3, '', '  '] as any, onCreate: 'nope' as any, format: 5 as any }, undefined);
    expect(m.list).toEqual(['ok']);
    expect(m.onCreate).toEqual([]);
    expect(m.facts).toEqual([]);
    expect(m.tags).toEqual([]);
  });
});

const renderField = async (options: TemplateOverviewOptions | undefined, e: any = entity()) => {
  const getEntityByRef = jest.fn(async () => e);
  await renderInTestApp(
    <TestApiProvider apis={[[catalogApiRef, { getEntityByRef } as any]]}>
      <Routes>
        <Route
          path="/create/templates/:namespace/:templateName"
          element={<TemplateOverviewField {...({ uiSchema: { 'ui:options': options } } as any)} />}
        />
      </Routes>
    </TestApiProvider>,
    { routeEntries: ['/create/templates/default/terraform-capstone-a-training-local'] },
  );
  return getEntityByRef;
};

describe('TemplateOverviewField', () => {
  it('shows the authored sections, the requirements read from the template, and the tags', async () => {
    const lookup = await renderField(authored);
    expect(await screen.findByText('Backstage agent 0.1.23 or newer, online. Docker with at least 4 GB of memory.')).toBeInTheDocument();
    expect(lookup).toHaveBeenCalledWith('template:default/terraform-capstone-a-training-local');
    expect(screen.getByText('5 days, solo')).toBeInTheDocument();
    expect(screen.getByText('What you will do')).toBeInTheDocument();
    expect(screen.getByText('Three environments from one module')).toBeInTheDocument();
    const steps = screen.getByText('What happens when you press Create').parentElement as HTMLElement;
    expect(within(steps).getAllByRole('listitem').map(li => li.textContent)).toEqual([
      'Your Backstage agent is checked.',
      'Your private capstone repository is created on GitHub.',
      'The lab starts on your laptop.',
    ]);
    expect(screen.getByText('terraform')).toBeInTheDocument();
  });

  it('with nothing authored shows the description, what it needs and its tags', async () => {
    await renderField(undefined, entity({ description: 'Run a database on your laptop.', tags: ['database'] }));
    expect(await screen.findByText('Run a database on your laptop.')).toBeInTheDocument();
    expect(screen.getByText('Your laptop')).toBeInTheDocument();
    expect(screen.getByText('database')).toBeInTheDocument();
    expect(screen.queryByText('What you get')).not.toBeInTheDocument();
  });

  it('still shows what the author wrote when the template cannot be read', async () => {
    const getEntityByRef = jest.fn(async () => {
      throw new Error('catalog down');
    });
    await renderInTestApp(
      <TestApiProvider apis={[[catalogApiRef, { getEntityByRef } as any]]}>
        <Routes>
          <Route path="/create/templates/:namespace/:templateName" element={<TemplateOverviewField {...({ uiSchema: { 'ui:options': authored } } as any)} />} />
        </Routes>
      </TestApiProvider>,
      { routeEntries: ['/create/templates/default/x'] },
    );
    expect(await screen.findByText('5 days, solo')).toBeInTheDocument();
    expect(screen.getByText('Three environments from one module')).toBeInTheDocument();
    // ...and says what is missing instead of looking like the lab needs nothing.
    expect(await screen.findByRole('note')).toHaveTextContent('could not be read just now');
    expect(screen.queryByText(/^Backstage agent/)).not.toBeInTheDocument();
  });

  it('shows no such note when the template was read', async () => {
    await renderField(authored);
    await screen.findByText('5 days, solo');
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('marks up facts, sections and tags so a screen reader can follow them', async () => {
    await renderField(authored);
    await screen.findByText('5 days, solo');
    expect(screen.getByText('Format').tagName).toBe('DT');
    expect(screen.getByText('5 days, solo').tagName).toBe('DD');
    expect(screen.getByRole('heading', { name: 'What you will do' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'What happens when you press Create' })).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Tags' })).getAllByRole('listitem').map(li => li.textContent)).toEqual(['training', 'terraform']);
  });
});
