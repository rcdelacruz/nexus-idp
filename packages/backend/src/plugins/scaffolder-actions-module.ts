/**
 * Scaffolder backend module for custom actions
 * Registers Stratpoint-specific scaffolder actions
 */

import { coreServices, createBackendModule } from '@backstage/backend-plugin-api';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node';
import { notificationService } from '@backstage/plugin-notifications-node';
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
import { createDispatchWorkflowAction } from './scaffolder/actions/dispatchWorkflow';
import { createSetupRepoForPromotionAction } from './scaffolder/actions/setupRepoForPromotion';
import { createDbaasCreateProjectAction } from './scaffolder/actions/dbaasCreateProject';
import { createAddRepoCollaboratorAction } from './scaffolder/actions/addRepoCollaborator';
import { createTeardownDiscoverResourcesAction } from './scaffolder/actions/teardownDiscoverResources';
import { createDeleteArgocdAppAction } from './scaffolder/actions/deleteArgocdApp';
import { createDeleteNamespaceAction } from './scaffolder/actions/deleteNamespace';
import { createDeleteGithubRepoAction } from './scaffolder/actions/deleteGithubRepo';
import { createUnregisterCatalogEntityAction } from './scaffolder/actions/unregisterCatalogEntity';
import { createNotifySendAction } from './scaffolder/actions/notifySend';
import { createDestroyAwsInfraAction } from './scaffolder/actions/destroyAwsInfra';
import { createDeleteS3BackupsAction } from './scaffolder/actions/deleteS3Backups';

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
        notification: notificationService,
      },
      async init({ scaffolder, config, discovery, auth, notification }) {
        scaffolder.addActions(
          createLocalProvisionAction({ discovery, auth }),
          createKubernetesApplyAction(),
          createPullSecretAction(),
          createAppSecretsAction(),
          createSetRepoSecretAction(),
          createGetIngressDomainAction({ config }),
          createResolveSkeletonUrlAction({ config }),
          createGetTargetsAction({ config }),
          createGetTargetConfigAction({ config, discovery, auth }),
          createFetchEntityInfoAction({ discovery, auth }),
          createTofuApplyAction(),
          createDispatchWorkflowAction(),
          createSetupRepoForPromotionAction(),
          createDbaasCreateProjectAction({ discovery, auth }),
          createAddRepoCollaboratorAction(),
          createTeardownDiscoverResourcesAction({ discovery, auth }),
          createDeleteArgocdAppAction(),
          createDeleteNamespaceAction(),
          createDeleteGithubRepoAction(),
          createUnregisterCatalogEntityAction({ discovery, auth }),
          createNotifySendAction({ notification }),
          createDestroyAwsInfraAction(),
          createDeleteS3BackupsAction(),
        );
      },
    });
  },
});

export default scaffolderActionsModule;
