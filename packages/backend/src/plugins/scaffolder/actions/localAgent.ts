/**
 * "Is this person's Backstage agent ready for a lab?" — one check shared by
 * `stratpoint:local-agent-check` (the FIRST step of every lab template, before a repo, an
 * enrollment or a trainee number is created) and `stratpoint:local-provision` (the last step,
 * which queues the lab). Before the preflight existed the check only ran last, so a trainee
 * without a running agent was left with a half-made capstone (repo + enrollment, no lab).
 */
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { InputError } from '@backstage/errors';
import { AuthService, DiscoveryService, RootConfigService } from '@backstage/backend-plugin-api';

/** An agent row from GET /api/local-provisioner/agent (fields this check uses). */
export interface AgentRow {
  agent_id: string;
  agent_version?: string | null;
  is_connected?: boolean;
  last_seen_age_seconds?: number | null;
  capabilities?: { arch?: string; dockerMemoryBytes?: number };
}

export interface MachineRequirements {
  minDockerMemoryGb?: number;
  architectures?: string[];
}

/** "30 s ago" / "5 min ago": seconds while it is recent, so a just-stopped agent doesn't read "1 min". */
export function agoText(seconds: number): string {
  return seconds < 90 ? `${Math.round(seconds)} s ago` : `${Math.round(seconds / 60)} min ago`;
}

/** True when a is an x.y.z version older than b (anything unparseable is not "older"). */
export function versionBelow(a: string | null | undefined, b: string): boolean {
  const pa = /^(\d+)\.(\d+)\.(\d+)$/.exec(a ?? '');
  const pb = /^(\d+)\.(\d+)\.(\d+)$/.exec(b);
  if (!pa || !pb) return false;
  for (let i = 1; i <= 3; i++) {
    if (Number(pa[i]) !== Number(pb[i])) return Number(pa[i]) < Number(pb[i]);
  }
  return false;
}

/**
 * Why the trainee's machine can't run a lab, or undefined. Unknown capabilities (older agents)
 * never block.
 */
export function machineRequirementProblem(
  req: MachineRequirements | undefined,
  caps: { arch?: string; dockerMemoryBytes?: number } | undefined,
): string | undefined {
  if (!req || !caps) return undefined;
  if (req.architectures?.length && caps.arch && !req.architectures.includes(caps.arch)) {
    return `This lab doesn't run on your machine's CPU (${caps.arch}). Supported: ${req.architectures.join(', ')}.`;
  }
  if (req.minDockerMemoryGb && caps.dockerMemoryBytes) {
    const have = caps.dockerMemoryBytes / 1024 ** 3;
    // Docker reports slightly less than the configured limit (e.g. 3.8 GiB for "4 GB"), so allow 10%.
    if (have < req.minDockerMemoryGb * 0.9) {
      return (
        `This lab needs about ${req.minDockerMemoryGb} GB of memory for Docker; yours has ${have.toFixed(1)} GB.\n\n` +
        'Raise it, then run the template again:\n' +
        '  • Docker Desktop (Mac/Windows): Settings → Resources → Memory\n' +
        '  • Windows with WSL2: set memory= in %UserProfile%\\.wslconfig, then `wsl --shutdown`\n' +
        '  • Colima: colima start --memory <GB>\n' +
        '  • OrbStack: Settings → System → Memory limit'
      );
    }
  }
  return undefined;
}

/**
 * The agent to use, or the reason none can be used (with the fix). `agents` is the user's list,
 * most recently active first (as the API returns it).
 */
export function agentReadiness(
  agents: AgentRow[],
  opts: { requirements?: MachineRequirements; minAgentVersion?: string; portalUrl?: string },
): { agent: AgentRow; problem?: undefined } | { agent?: undefined; problem: string } {
  const setup = opts.portalUrl ? `${opts.portalUrl}/local-provisioner` : 'the Local Provisioner page';
  if (!agents.length) {
    return {
      problem:
        "You haven't set up the Backstage agent yet. Labs run on your own laptop through it.\n\n" +
        '  1. Install: npm install -g @stratpoint/backstage-agent\n' +
        `  2. Sign in: backstage-agent login${opts.portalUrl ? ` --url ${opts.portalUrl}` : ''}\n\n` +
        `Step-by-step guide: ${setup}. Then run this template again.`,
    };
  }
  // is_connected is the server's verdict (GET /agent?verify=1: each apparently-online agent was
  // woken and had to answer, so it is proven alive, not inferred from an age). Don't second-guess
  // it with last_seen: that kept a just-stopped agent "online" for 90 s (2026-10-31).
  const online = agents.filter(a => a.is_connected === true);
  if (!online.length) {
    const age = agents[0].last_seen_age_seconds;
    const lastSeen = typeof age === 'number' ? `last seen ${agoText(age)}` : 'never seen';
    return {
      problem:
        `Your Backstage agent is offline (${lastSeen}). Labs run on your laptop through it.\n\n` +
        'Start it on the laptop you want the lab on, then run this template again:\n' +
        '  backstage-agent start\n\n' +
        '(If your session expired: backstage-agent login)',
    };
  }
  const agent = online[0];
  if (opts.minAgentVersion && versionBelow(agent.agent_version, opts.minAgentVersion)) {
    return {
      problem:
        `This lab needs Backstage agent ${opts.minAgentVersion} or newer; yours is ${agent.agent_version}.\n\n` +
        'Update it, then run this template again:\n' +
        '  backstage-agent update',
    };
  }
  const machine = machineRequirementProblem(opts.requirements, agent.capabilities);
  if (machine) return { problem: machine };
  return { agent };
}

export interface LocalAgentOptions {
  discovery: DiscoveryService;
  auth: AuthService;
  config: RootConfigService;
}

/**
 * Fetches the initiating user's agents (on their behalf: the local-provisioner API scopes every
 * endpoint by user) and returns the one to use, or throws an InputError with the fix.
 */
export async function requireReadyAgent(
  options: LocalAgentOptions,
  ctx: { getInitiatorCredentials(): Promise<any>; logger: { info(msg: string): void } },
  opts: { requirements?: MachineRequirements; minAgentVersion?: string },
): Promise<{ agent: AgentRow; token: string; baseUrl: string }> {
  const { token } = await options.auth.getPluginRequestToken({
    onBehalfOf: await ctx.getInitiatorCredentials(),
    targetPluginId: 'local-provisioner',
  });
  const baseUrl = await options.discovery.getBaseUrl('local-provisioner');
  // verify=1: this decides whether anything gets created, so the agent has to prove it is alive.
  const res = await fetch(`${baseUrl}/agent?verify=1`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Failed to query agent status: ${res.status} - ${await res.text()}`);
  const body = (await res.json()) as { agents?: AgentRow[] };
  const result = agentReadiness(Array.isArray(body.agents) ? body.agents : [], {
    ...opts,
    portalUrl: options.config.getOptionalString('app.baseUrl'),
  });
  if (result.problem !== undefined) throw new InputError(result.problem);
  ctx.logger.info(`Agent ready: ${result.agent.agent_id} (v${result.agent.agent_version ?? '?'})`);
  return { agent: result.agent, token, baseUrl };
}

/**
 * `stratpoint:local-agent-check`: the first step of a lab template. Fails, with the fix, before
 * the template creates anything when the user's agent isn't set up, isn't running, is too old for
 * this lab, or their machine can't run it. The last step (`stratpoint:local-provision`) checks again.
 */
export const createLocalAgentCheckAction = (options: LocalAgentOptions) =>
  createTemplateAction({
    id: 'stratpoint:local-agent-check',
    description: "Check that the user's Backstage agent can run this lab, before anything is created",
    schema: {
      input: {
        minAgentVersion: z =>
          z
            .string()
            .regex(/^\d+\.\d+\.\d+$/)
            .optional()
            .describe('Oldest agent that can run this lab (e.g. 0.1.29 for labs that mount the trainee repo)'),
        requirements: z =>
          z
            .object({
              minDockerMemoryGb: z.number().positive().optional(),
              architectures: z.array(z.string()).optional(),
            })
            .optional()
            .describe("What the trainee's machine needs (same as stratpoint:local-provision's requirements)"),
      },
      output: {
        agentId: z => z.string(),
        agentVersion: z => z.string().optional(),
      },
    },
    async handler(ctx) {
      const { agent } = await requireReadyAgent(options, ctx, {
        requirements: ctx.input.requirements,
        minAgentVersion: ctx.input.minAgentVersion,
      });
      ctx.output('agentId', agent.agent_id);
      if (agent.agent_version) ctx.output('agentVersion', agent.agent_version);
    },
  });
