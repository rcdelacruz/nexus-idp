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
import { requireReadyAgent } from './localAgent';

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

export { machineRequirementProblem } from './localAgent';

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
        dockerComposeFile: z =>
          z.string({ description: 'Path to the rendered docker-compose.yml file (relative to workspace). Not used for VM labs (vm).' }).optional(),
        vm: z =>
          z
            .object({
              image: z.string(),
              cpus: z.number().int(),
              memoryGb: z.number().int(),
              diskGb: z.number().int(),
              sshUser: z.string(),
              seedDir: z.string({ description: 'Workspace dir whose files are copied into the VM at /tmp/lab-seed' }),
              seedCommand: z.array(z.string()),
              seedEnv: z.record(z.string(), z.string()).optional(),
            })
            .optional()
            .describe('VM lab (Multipass, agent ≥ 0.1.23) instead of Docker Compose — e.g. the Linux capstone'),
        sourceDir: z => z.string({ description: 'Path (relative to workspace) to a fetched source directory the compose file builds images from, e.g. ./rendered/app — sent to the agent alongside the compose file so `build: context:` has something to build. Omit for templates that only reference public images.' }).optional(),
        config: z => z.record(z.string(), z.unknown()).optional(),
        requirements: z =>
          z
            .object({
              minDockerMemoryGb: z.number().positive().optional(),
              architectures: z.array(z.string()).optional(),
            })
            .optional()
            .describe("What the trainee's machine needs (checked against what their agent reports; older agents report nothing and are let through)"),
      },
      output: {
        taskId: z => z.string(),
        taskUrl: z => z.string(),
        catalogUrl: z => z.string(),
      },
    },
    async handler(ctx) {
      const { taskType, resourceName, dockerComposeFile, sourceDir, config = {}, vm } = ctx.input;

      ctx.logger.info(`Queuing ${taskType} task for resource: ${resourceName}`);

      // VM labs: the seed files travel with the VM spec; there is no compose file.
      let vmConfig: Record<string, unknown> | undefined;
      if (vm) {
        const seedAbs = path.join(ctx.workspacePath, vm.seedDir);
        if (!(await fs.pathExists(seedAbs))) throw new InputError(`vm.seedDir not found: ${vm.seedDir}`);
        const seedFiles: Record<string, string> = {};
        for (const entry of await fs.readdir(seedAbs, { withFileTypes: true })) {
          if (entry.isFile()) seedFiles[entry.name] = (await fs.readFile(path.join(seedAbs, entry.name))).toString('base64');
        }
        const { seedDir: _seedDir, ...rest } = vm;
        vmConfig = { ...rest, seedFiles };
        ctx.logger.info(`VM lab: ${vm.image}, ${vm.cpus} CPU, ${vm.memoryGb} GB RAM, ${vm.diskGb} GB disk, ${Object.keys(seedFiles).length} seed file(s)`);
      } else if (!dockerComposeFile) {
        throw new InputError('Either dockerComposeFile or vm is required');
      }

      // Read the rendered docker-compose.yml from workspace
      const dockerComposePath = vm ? '' : path.join(ctx.workspacePath, dockerComposeFile!);

      if (!vm && !(await fs.pathExists(dockerComposePath))) {
        throw new InputError(
          `Docker Compose file not found: ${dockerComposeFile}. ` +
          `Make sure to run fetch:template action first to render the template.`
        );
      }

      const dockerComposeTemplate = vm ? '' : await fs.readFile(dockerComposePath, 'utf-8');
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

      // The same readiness check the template's first step (stratpoint:local-agent-check) ran, again
      // here: the agent may have stopped since. Delegates the initiator's identity — the
      // local-provisioner API scopes every endpoint by the user (see localAgent.ts).
      const { agent: activeAgent, token, baseUrl } = await requireReadyAgent(
        { discovery, auth, config: rootConfig },
        ctx,
        { requirements: ctx.input.requirements },
      );

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
              ...(vmConfig
                ? { executor: 'multipass', vm: vmConfig }
                : { dockerCompose: dockerComposeContent }), // rendered docker-compose.yml
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
