/**
 * Custom scaffolder action for queuing local provisioning tasks
 *
 * This action reads a rendered docker-compose.yml from the workspace
 * and creates a provisioning task in the backend for the agent to execute.
 */

import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { InputError } from '@backstage/errors';
import { AuthService, DiscoveryService, RootConfigService } from '@backstage/backend-plugin-api';
import fs from 'fs-extra';
import path from 'path';
import Mustache from 'mustache';

/**
 * Recursively reads every file under `dir` (relative to the workspace) and returns a
 * { "<dirBasename>/<relativePath>": "<base64>" } map — e.g. sourceDir `./rendered/app` yields
 * keys like "app/backend/Dockerfile". Sent to the agent alongside the compose file so
 * `build: context: ./app/...` has something to actually build from — previously only the
 * rendered docker-compose.yml text ever reached the agent, so any template referencing a
 * fetched source directory (rather than a public image) failed with "path ... not found".
 */
async function collectSourceFiles(absDir: string, dirBasename: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const walk = async (current: string, relPrefix: string) => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      const rel = path.posix.join(relPrefix, entry.name);
      if (entry.isDirectory()) {
        await walk(abs, rel);
      } else if (entry.isFile()) {
        const content = await fs.readFile(abs);
        result[path.posix.join(dirBasename, rel)] = content.toString('base64');
      }
    }
  };
  await walk(absDir, '');
  return result;
}

/**
 * Derives an email from a Backstage user entity ref (e.g. `user:default/jane.doe` ->
 * `jane.doe@<domain>`) when the catalog User entity isn't available. Mirrors
 * extractEmailFromEntityRef in plugins/local-provisioner-backend/src/util/identity.ts (not
 * importable across workspace packages, so duplicated here — keep both in sync if either
 * changes).
 */
function deriveEmailFromRef(ref: string | undefined, domain: string): string | undefined {
  if (!ref) return undefined;
  const parts = ref.split('/');
  if (parts.length !== 2) return undefined;
  const username = parts[1];
  return username.includes('@') ? username : `${username}@${domain}`;
}

export interface LocalProvisionActionOptions {
  discovery: DiscoveryService;
  auth: AuthService;
  config: RootConfigService;
}

export const createLocalProvisionAction = (options: LocalProvisionActionOptions) => {
  const { discovery, auth, config: rootConfig } = options;

  return createTemplateAction({
    id: 'stratpoint:local-provision',
    description: 'Queue a local provisioning task for agent execution',
    schema: {
      input: {
        taskType: z => z.string({ description: 'Type of provisioning task (e.g., provision-kafka)' }),
        resourceName: z => z.string({ description: 'Unique name for the resource' }),
        dockerComposeFile: z => z.string({ description: 'Path to the rendered docker-compose.yml file (relative to workspace)' }),
        sourceDir: z => z.string({ description: 'Path (relative to workspace) to a fetched source directory the compose file builds images from, e.g. ./rendered/app — sent to the agent alongside the compose file so `build: context:` has something to build. Omit for templates that only reference public images.' }).optional(),
        config: z => z.record(z.string(), z.unknown()).optional(),
      },
      output: {
        taskId: z => z.string(),
        taskUrl: z => z.string(),
        catalogUrl: z => z.string(),
      },
    },
    async handler(ctx) {
      const { taskType, resourceName, dockerComposeFile, sourceDir, config = {} } = ctx.input;

      ctx.logger.info(`Queuing ${taskType} task for resource: ${resourceName}`);

      // Read the rendered docker-compose.yml from workspace
      const dockerComposePath = path.join(ctx.workspacePath, dockerComposeFile);

      if (!await fs.pathExists(dockerComposePath)) {
        throw new InputError(
          `Docker Compose file not found: ${dockerComposeFile}. ` +
          `Make sure to run fetch:template action first to render the template.`
        );
      }

      const dockerComposeTemplate = await fs.readFile(dockerComposePath, 'utf-8');
      ctx.logger.debug(`Read docker-compose.yml template (${dockerComposeTemplate.length} bytes)`);

      // If the compose file builds images from a fetched source directory (rather than only
      // referencing public images), bundle that source into the task payload so the agent has
      // something to build from — it never receives anything from the workspace besides what
      // we explicitly send here.
      let sourceFiles: Record<string, string> | undefined;
      if (sourceDir) {
        const sourceAbsPath = path.join(ctx.workspacePath, sourceDir);
        if (!await fs.pathExists(sourceAbsPath)) {
          throw new InputError(`sourceDir not found: ${sourceDir}`);
        }
        sourceFiles = await collectSourceFiles(sourceAbsPath, path.basename(sourceDir));
        ctx.logger.info(`Bundled ${Object.keys(sourceFiles).length} source file(s) from ${sourceDir}`);
      }

      // Render template with Mustache using config values
      // Template uses {{ values.X }} syntax, so wrap config in values object
      const templateData = {
        values: {
          resourceName,
          kafkaVersion: config?.kafkaVersion || '7.5.0',
          port: config?.port || 9092,
          zookeeperPort: config?.zookeeperPort || 2181,
          uiPort: config?.uiPort || 8080,
          autoCreateTopics: config?.autoCreateTopics !== undefined ? config.autoCreateTopics : true,
          numPartitions: config?.numPartitions || 3,
          replicationFactor: config?.replicationFactor || 1,
          ...config,
        },
      };

      const dockerComposeContent = Mustache.render(dockerComposeTemplate, templateData);
      ctx.logger.debug(`Rendered docker-compose.yml (${dockerComposeContent.length} bytes)`);

      // Get user information from context. The catalog User entity may not exist yet — new
      // users aren't synced into the catalog until they're assigned a dept team (see
      // UserEntityProvider's ghost-row filter), but they can already reach this action via
      // training templates. Fall back to deriving the email from the raw entity ref, which
      // comes straight from the initiator's identity token, not a catalog lookup.
      const userEmail =
        (ctx.user?.entity?.spec?.profile?.email as string | undefined) ??
        deriveEmailFromRef(ctx.user?.ref, rootConfig.getString('organization.domain'));

      if (!userEmail) {
        throw new InputError('User email not found. Please ensure you are logged in with a valid user.');
      }

      // Mint an on-behalf-of token for the user who initiated the scaffolder run, so the
      // local-provisioner API resolves req.user to that user and returns *their* agent and
      // creates the task under their identity. Sibling actions target catalog/dbaas with
      // service credentials, but local-provisioner scopes every endpoint by user email and
      // its middleware only accepts user principals — so we delegate the initiator's identity
      // rather than using getOwnServiceCredentials().
      const { token } = await auth.getPluginRequestToken({
        onBehalfOf: await ctx.getInitiatorCredentials(),
        targetPluginId: 'local-provisioner',
      });

      // Get base URL for local-provisioner plugin using injected discovery service
      const baseUrl = await discovery.getBaseUrl('local-provisioner');

      // Query agents via HTTP API (each plugin has isolated database schemas)
      ctx.logger.info(`Querying agents from: ${baseUrl}/agent`);
      ctx.logger.debug(`Token type: ${typeof token}, length: ${token?.length}`);

      const agentResponse = await fetch(
        `${baseUrl}/agent`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      ctx.logger.info(`Agent API response status: ${agentResponse.status}`);

      if (!agentResponse.ok) {
        const errorText = await agentResponse.text();
        ctx.logger.error(`Agent API error response: ${errorText}`);
        throw new Error(`Failed to query agent status: ${agentResponse.status} - ${errorText}`);
      }

      const response = await agentResponse.json() as any;
      ctx.logger.info(`Received agents response: ${JSON.stringify(response)}`);

      // API returns {agents: [...], total: number}
      const agents = response.agents || [];

      if (!Array.isArray(agents) || agents.length === 0) {
        throw new InputError(
          'No agent found for your user. Please install and start the Backstage agent:\n\n' +
          '  1. Install: npm install -g @stratpoint/backstage-agent\n' +
          '  2. Login: backstage-agent login --url <your-backstage-url>\n' +
          '  3. Start: backstage-agent start\n\n' +
          'Then try running this template again.'
        );
      }

      // Do NOT queue to an offline agent — the task would sit "pending" forever. Require a
      // currently-online agent (connected, or a fresh heartbeat within the last 90s).
      const ONLINE_MAX_AGE_SECONDS = 90;
      const isOnline = (a: any): boolean => {
        if (a.is_connected) return true;
        const age = a.last_seen_age_seconds;
        return typeof age === 'number' && age <= ONLINE_MAX_AGE_SECONDS;
      };

      const onlineAgents = agents.filter(isOnline);
      if (onlineAgents.length === 0) {
        const mostRecent = agents[0];
        const lastSeen =
          typeof mostRecent?.last_seen_age_seconds === 'number'
            ? `last seen ${mostRecent.last_seen_age_seconds}s ago`
            : 'never seen';
        throw new InputError(
          `Your Backstage agent is offline (${lastSeen}), so this resource cannot be provisioned.\n\n` +
          'Start it on the machine where you want the resource, then try again:\n' +
          '  backstage-agent start\n\n' +
          '(If your session expired: backstage-agent login)',
        );
      }

      // Use the most recently active ONLINE agent.
      const activeAgent = onlineAgents[0];

      ctx.logger.info(`Using agent: ${activeAgent.agent_id} (last seen: ${activeAgent.last_seen})`);

      // Create provisioning task
      const createTaskResponse = await fetch(
        `${baseUrl}/tasks`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            task_type: taskType,
            resource_name: resourceName,
            agent_id: activeAgent.agent_id,
            config: {
              ...config,
              dockerCompose: dockerComposeContent, // Pass rendered docker-compose.yml
              ...(sourceFiles ? { sourceFiles } : {}),
            },
            priority: 5,
          }),
        }
      );

      if (!createTaskResponse.ok) {
        const errorText = await createTaskResponse.text();
        throw new Error(`Failed to create provisioning task: ${createTaskResponse.status} ${errorText}`);
      }

      const task = await createTaskResponse.json() as any;

      ctx.logger.info(`Provisioning task created: ${task.task_id}`);

      // Set outputs
      ctx.output('taskId', task.task_id);
      ctx.output('taskUrl', `/local-provisioner/tasks/${task.task_id}`);
      ctx.output('catalogUrl', `/catalog/default/resource/${resourceName}`);

      ctx.logger.info('Local provisioning task queued successfully');
    },
  });
};
