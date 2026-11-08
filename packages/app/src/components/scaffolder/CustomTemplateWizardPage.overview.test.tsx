import React from 'react';
// This test reads the engineering-standards templates from disk (the app code itself never does).
// eslint-disable-next-line no-restricted-imports
import fs from 'fs';
// eslint-disable-next-line no-restricted-imports
import path from 'path';
import yaml from 'yaml';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Route, Routes } from 'react-router-dom';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import { scaffolderApiRef, SecretsContextProvider } from '@backstage/plugin-scaffolder-react';
import { CustomTemplateWizardPage } from './CustomTemplateWizardPage';
import { TemplateOverviewField } from './TemplateOverviewField';

jest.setTimeout(30000);

// jsdom has no scrollTo; the page scrolls <main> to the top on every step change.
beforeAll(() => {
  (Element.prototype as any).scrollTo = jest.fn();
});

/**
 * The real wizard page with the real TemplateOverview field, fed a template whose first page is the
 * Overview page (as in the engineering-standards lab templates): the page must show it as step 1
 * next to the other steps, let the user go on, and keep it out of the Review page.
 */
const manifest = {
  title: 'Terraform Capstone A: Botika Bayan Orders Platform',
  description: 'Build a pharmacy chain\'s AWS platform. More text.',
  steps: [
    {
      title: 'Overview',
      // As the scaffolder backend sends it: ui:* keys sit inside the schema property.
      schema: {
        type: 'object',
        properties: {
          overview: {
            type: 'string',
            'ui:field': 'TemplateOverview',
            'ui:options': { format: '5 days, solo', list: ['Three environments from one module'], onCreate: ['The lab starts on your laptop.'] },
          },
        },
      },
    },
    {
      title: 'Your capstone',
      schema: { type: 'object', properties: { resourceName: { type: 'string', title: 'Lab Name' } } },
    },
  ],
};

const entity: any = {
  apiVersion: 'scaffolder.backstage.io/v1beta3',
  kind: 'Template',
  metadata: { name: 'terraform-capstone-a-training-local', description: 'Build a pharmacy chain\'s AWS platform. More text.', tags: ['training'] },
  spec: { steps: [{ action: 'stratpoint:local-agent-check', input: { minAgentVersion: '0.1.23', requirements: { minDockerMemoryGb: 4 } } }, { action: 'stratpoint:local-provision' }] },
};

async function openWizard(m: any = manifest, e: any = entity, name = 'terraform-capstone-a-training-local') {
  const scaffolder = { getTemplateParameterSchema: jest.fn(async () => m), scaffold: jest.fn() };
  await renderInTestApp(
    <TestApiProvider apis={[[scaffolderApiRef, scaffolder as any], [catalogApiRef, { getEntityByRef: async () => e } as any]]}>
      <SecretsContextProvider>
        <Routes>
          <Route
            path="/create/templates/:namespace/:templateName"
            element={
              <CustomTemplateWizardPage
                {...({ customFieldExtensions: [{ name: 'TemplateOverview', component: TemplateOverviewField }] } as any)}
              />
            }
          />
        </Routes>
      </SecretsContextProvider>
    </TestApiProvider>,
    { routeEntries: [`/create/templates/default/${name}`] },
  );
}

const press = (el: HTMLElement) =>
  act(async () => {
    fireEvent.click(el);
  });

describe('wizard with an Overview first step', () => {
  it('lists Overview as step 1, shows it, goes on to the next step, and keeps it out of Review', async () => {
    await openWizard();

    // Step list: Overview, Your capstone, Review. The Overview card is showing.
    expect(await screen.findByText('5 days, solo')).toBeInTheDocument();
    expect(screen.getByText('Three environments from one module')).toBeInTheDocument();
    expect(screen.getByText('Backstage agent 0.1.23 or newer, online. Docker with at least 4 GB of memory.')).toBeInTheDocument();
    expect(screen.getAllByText('Overview').length).toBeGreaterThan(0);
    expect(screen.getByText('Your capstone')).toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();

    // First step: Back is disabled, Next is not (nothing is required on this page).
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    const next = screen.getByRole('button', { name: 'Next' });
    expect(next).toBeEnabled();

    await press(next);
    const name = await screen.findByLabelText(/Lab Name/);
    expect(screen.queryByText('5 days, solo')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled();

    // Back returns to the Overview.
    await press(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('5 days, solo')).toBeInTheDocument();

    // Forward again, fill the second page, go to Review: only what the user entered is listed.
    await press(screen.getByRole('button', { name: 'Next' }));
    const input = await screen.findByLabelText(/Lab Name/);
    fireEvent.change(input, { target: { value: 'my-lab' } });
    expect(name).toBeDefined();
    await press(screen.getByRole('button', { name: 'Review' }));
    expect(await screen.findByText(/Review & Create/i)).toBeInTheDocument();
    expect(screen.getByText('my-lab')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('5 days, solo')).not.toBeInTheDocument());
    // The Review card lists what the user entered and nothing for the Overview ("Overview" is still the
    // first entry of the step list on the left, so look inside the card only).
    const review = screen.getByText(/Review & Create/i).parentElement as HTMLElement;
    expect(review).toHaveTextContent('Lab Name');
    expect(review).not.toHaveTextContent(/overview/i);
  });
});

// The real templates, through the real page: every engineering-standards template that has an
// Overview page shows its own text, the requirement line read from its own agent-check step, and
// its tags. Skipped when the templates are not checked out next to this repo.
const ROOT = process.env.ENGINEERING_STANDARDS_DIR ?? path.resolve(__dirname, '../../../../../../engineering-standards');
const TEMPLATE_DIRS = ['templates/training', 'templates/projects/local'];
const real: { name: string; template: any }[] = [];
const allTemplates: any[] = [];
for (const dir of TEMPLATE_DIRS) {
  const base = path.join(ROOT, dir);
  if (!fs.existsSync(base)) continue;
  for (const lab of fs.readdirSync(base)) {
    const f = path.join(base, lab, 'template.yaml');
    if (!fs.existsSync(f)) continue;
    const template = yaml.parse(fs.readFileSync(f, 'utf8'));
    allTemplates.push(template);
    const pages: any[] = Array.isArray(template.spec?.parameters) ? template.spec.parameters : [];
    if (pages.some(pg => Object.values<any>(pg.properties ?? {}).some(p => p?.['ui:field'] === 'TemplateOverview'))) {
      real.push({ name: template.metadata.name, template });
    }
  }
}
const maybe = real.length ? describe : describe.skip;

maybe(`real templates (${ROOT})`, () => {
  it('finds the templates that have an Overview page', () => {
    expect(real.length).toBeGreaterThanOrEqual(12);
  });

  // A template naming a field the app does not register renders a plain text box in its place (the
  // Overview would show as an input called "overview"), so the names must match App.tsx. Every lab
  // template is checked, not only those that already have an Overview page.
  it('every field the lab templates use is registered in App.tsx or built into Backstage', () => {
    const appSource = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
    const builtIn = ['OwnerPicker', 'EntityPicker', 'EntityNamePicker', 'EntityTagsPicker', 'OwnedEntityPicker', 'MultiEntityPicker', 'RepoUrlPicker', 'MyGroupsPicker'];
    const used = new Set<string>();
    for (const template of allTemplates) {
      const pages: any[] = Array.isArray(template.spec?.parameters) ? template.spec.parameters : [template.spec?.parameters ?? {}];
      for (const page of pages) {
        for (const prop of Object.values<any>(page.properties ?? {})) {
          if (typeof prop?.['ui:field'] === 'string') used.add(prop['ui:field']);
        }
      }
    }
    const unregistered = [...used].filter(n => !builtIn.includes(n) && !appSource.includes(`name: '${n}'`));
    expect(unregistered).toEqual([]);
    expect(used.has('TemplateOverview')).toBe(true);
    expect(allTemplates.length).toBeGreaterThan(real.length - 1);
  });

  it.each(real.map(r => [r.name, r.template] as const))('%s: the first step shows its own overview', async (name, template) => {
    const pages: any[] = template.spec.parameters;
    const m = {
      title: template.metadata.title,
      description: template.metadata.description,
      steps: pages.map(pg => ({ title: pg.title, schema: { type: 'object', properties: pg.properties, required: pg.required } })),
    };
    const e = { apiVersion: template.apiVersion, kind: 'Template', metadata: template.metadata, spec: template.spec };
    await openWizard(m, e, name);

    const options = pages[0].properties.overview['ui:options'];
    // What the author wrote (the first bullet, else the sentence under the heading).
    expect(await screen.findByText((options.list ?? [options.summary ?? options.onCreate[0]])[0])).toBeInTheDocument();
    // Read from the template's own agent-check step, never typed twice.
    expect(screen.getByText(/^Backstage agent( \d+\.\d+\.\d+ or newer)?, online\./)).toBeInTheDocument();
    expect(screen.getByText('Your Backstage agent is checked.')).toBeInTheDocument();
    expect(screen.getByText(template.metadata.tags[0])).toBeInTheDocument();
    // Overview is the first step and Back is disabled on it; Next is enabled.
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });
});
