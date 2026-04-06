import { createDevApp } from '@backstage/dev-utils';
import { projectRegistrationPlugin, ProjectRegistrationPage } from '../src/plugin';

createDevApp()
  .registerPlugin(projectRegistrationPlugin)
  .addPage({
    element: <ProjectRegistrationPage />,
    title: 'Root Page',
    path: '/project-registration',
  })
  .render();
