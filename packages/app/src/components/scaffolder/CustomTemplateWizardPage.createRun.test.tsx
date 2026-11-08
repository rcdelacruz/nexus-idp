import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Route, Routes, useLocation } from 'react-router-dom';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import { scaffolderApiRef, SecretsContextProvider } from '@backstage/plugin-scaffolder-react';
import { CustomTemplateWizardPage } from './CustomTemplateWizardPage';
import { isFreshRun } from './labRedirect';

jest.setTimeout(30000);

// jsdom has no scrollTo; the page scrolls <main> to the top on every step change.
beforeAll(() => {
  (Element.prototype as any).scrollTo = jest.fn();
});

const manifest = {
  title: 'Any template',
  description: 'Any template.',
  steps: [{ title: 'Name', schema: { type: 'object', properties: { resourceName: { type: 'string', title: 'Lab Name' } } } }],
};
const entity: any = {
  apiVersion: 'scaffolder.backstage.io/v1beta3',
  kind: 'Template',
  metadata: { name: 'any-template' },
  spec: { steps: [] },
};

/** The run page the wizard opens: shows where it is and what the wizard attached to the navigation. */
const RunProbe = () => {
  const { pathname, state } = useLocation();
  return (
    <div>
      <span data-testid="run-path">{pathname}</span>
      <span data-testid="run-fresh">{String(isFreshRun(state))}</span>
    </div>
  );
};

const press = (el: HTMLElement) =>
  act(async () => {
    fireEvent.click(el);
  });

describe('wizard: pressing Create', () => {
  it('opens the run page and marks the run as started just now, so a successful lab run can open the lab', async () => {
    const scaffold = jest.fn(async () => ({ taskId: 'run-42' }));
    const scaffolder = { getTemplateParameterSchema: jest.fn(async () => manifest), scaffold };
    await renderInTestApp(
      <TestApiProvider apis={[[scaffolderApiRef, scaffolder as any], [catalogApiRef, { getEntityByRef: async () => entity } as any]]}>
        <SecretsContextProvider>
          <Routes>
            <Route path="/create/templates/:namespace/:templateName" element={<CustomTemplateWizardPage {...({ customFieldExtensions: [] } as any)} />} />
            <Route path="/create/tasks/:taskId" element={<RunProbe />} />
          </Routes>
        </SecretsContextProvider>
      </TestApiProvider>,
      { routeEntries: ['/create/templates/default/any-template'] },
    );

    fireEvent.change(await screen.findByLabelText(/Lab Name/), { target: { value: 'my-lab' } });
    await press(screen.getByRole('button', { name: 'Review' }));
    await press(await screen.findByRole('button', { name: 'Create' }));

    expect(await screen.findByTestId('run-path')).toHaveTextContent('/create/tasks/run-42');
    expect(screen.getByTestId('run-fresh')).toHaveTextContent('true');
    expect(scaffold).toHaveBeenCalledTimes(1);
  });
});
