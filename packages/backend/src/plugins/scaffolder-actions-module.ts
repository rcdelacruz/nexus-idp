/**
 * Scaffolder backend module for custom actions
 * Registers Stratpoint-specific scaffolder actions
 */

import { coreServices, createBackendModule } from '@backstage/backend-plugin-api';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node';
import { createLocalProvisionAction } from './scaffolder/actions/localProvision';
import { createKubernetesApplyAction } from './scaffolder/actions/kubernetesApply';
import { createPullSecretAction } from './scaffolder/actions/createPullSecret';
import { createSetRepoSecretAction } from './scaffolder/actions/setRepoSecret';
import { createGetIngressDomainAction } from './scaffolder/actions/getIngressDomain';

export const scaffolderActionsModule = createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'stratpoint-actions',
  register(env) {
    env.registerInit({
      deps: {
        scaffolder: scaffolderActionsExtensionPoint,
        discovery: coreServices.discovery,
      },
      async init({ scaffolder, discovery }) {
        scaffolder.addActions(
          createLocalProvisionAction({ discovery }),
          createKubernetesApplyAction(),
          createPullSecretAction(),
          createSetRepoSecretAction(),
          createGetIngressDomainAction(),
        );
      },
    });
  },
});

export default scaffolderActionsModule;
