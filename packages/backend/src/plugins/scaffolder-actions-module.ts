/**
 * Scaffolder backend module for custom actions
 * Registers Stratpoint-specific scaffolder actions
 */

import { coreServices, createBackendModule } from '@backstage/backend-plugin-api';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node';
import { createLocalProvisionAction } from './scaffolder/actions/localProvision';
import { createKubernetesApplyAction } from './scaffolder/actions/kubernetesApply';
import { createPullSecretAction } from './scaffolder/actions/createPullSecret';
import { createAppSecretsAction } from './scaffolder/actions/createAppSecrets';
import { createSetRepoSecretAction } from './scaffolder/actions/setRepoSecret';
import { createGetIngressDomainAction } from './scaffolder/actions/getIngressDomain';
import { createResolveSkeletonUrlAction } from './scaffolder/actions/resolveSkeletonUrl';
import { createGetTargetsAction } from './scaffolder/actions/getTargets';
import { createGetTargetConfigAction } from './scaffolder/actions/getTargetConfig';
import { createFetchEntityInfoAction } from './scaffolder/actions/fetchEntityInfo';
import { createTofuApplyAction } from './scaffolder/actions/tofuApply';

export const scaffolderActionsModule = createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'stratpoint-actions',
  register(env) {
    env.registerInit({
      deps: {
        scaffolder: scaffolderActionsExtensionPoint,
        config: coreServices.rootConfig,
        discovery: coreServices.discovery,
        auth: coreServices.auth,
      },
      async init({ scaffolder, config, discovery, auth }) {
        scaffolder.addActions(
          createLocalProvisionAction({ discovery }),
          createKubernetesApplyAction(),
          createPullSecretAction(),
          createAppSecretsAction(),
          createSetRepoSecretAction(),
          createGetIngressDomainAction({ config }),
          createResolveSkeletonUrlAction({ config }),
          createGetTargetsAction({ config }),
          createGetTargetConfigAction({ config }),
          createFetchEntityInfoAction({ discovery, auth }),
          createTofuApplyAction(),
        );
      },
    });
  },
});

export default scaffolderActionsModule;
