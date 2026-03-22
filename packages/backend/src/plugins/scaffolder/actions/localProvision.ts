/**
 * Custom scaffolder action for queuing local provisioning tasks
 *
 * This action reads a rendered docker-compose.yml from the workspace
 * and creates a provisioning task in the backend for the agent to execute.
 */

import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { InputError } from '@backstage/errors';
import { DiscoveryService } from '@backstage/backend-plugin-api';
import fs from 'fs-extra';
import path from 'path';
import Mustache from 'mustache';


export interface LocalProvisionActionOptions {
  discovery: DiscoveryService;
}

export const createLocalProvisionAction = (options: LocalProvisionActionOptions) => {
  const { discovery } = options;

  return createTemplateAction({
    id: 'stratpoint:local-provision',
    description: 'Queue a local provisioning task for agent execution',
    schema: {
      input: {
        taskType: z => z.string({ description: 'Type of provisioning task (e.g., provision-kafka)' }),
        resourceName: z => z.string({ description: 'Unique name for the resource' }),
        dockerComposeFile: z => z.string({ description: 'Path to the rendered docker-compose.yml file (relative to workspace)' }),
        config: z => z.record(z.string(), z.unknown()).optional(),
      },
      output: {
        taskId: z => z.string(),
        taskUrl: z => z.string(),
        catalogUrl: z => z.string(),
      },
    },
    async handler(ctx) {
      const { taskType, resourceName, dockerComposeFile, config = {} } = ctx.input;

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

      // Get user information from context
      const userEmail = ctx.user?.entity?.spec?.profile?.email as string;

      if (!userEmail) {
        throw new InputError('User email not found. Please ensure you are logged in with a valid user.');
      }

      // Note: In new Backstage backend system, credentials are handled via BackstageCredentials
      // For scaffolder actions calling HTTP APIs, we use a placeholder token
      // TODO: Implement proper credential forwarding when Backstage API supports it
      const token = 'scaffolder-internal-token';

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
          '  2. Login: backstage-agent login --url http://localhost:7007\n' +
          '  3. Start: backstage-agent start\n\n' +
          'Then try running this template again.'
        );
      }

      // Use the most recently active agent (API returns sorted by last_seen desc)
      const activeAgent = agents[0];

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
