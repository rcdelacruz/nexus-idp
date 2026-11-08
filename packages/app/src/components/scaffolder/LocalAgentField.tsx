/**
 * LocalAgentField — custom scaffolder field extension for lab templates.
 *
 * Shows whether the user's Backstage agent (the program that runs labs on their laptop) is set up
 * and running, re-checks every 5 s, and blocks the form (validateLocalAgent) until it is: a lab
 * template must not create a repo or a capstone enrollment for a trainee whose lab can't start.
 *
 * Two kinds of check, on purpose: the 5 s look is the portal's inferred status (cheap; can trail a
 * vanished agent by up to ~45 s), while clicking Next PROVES it (GET /agent?verify=1: the server
 * wakes the agent and it has to answer). The template's first step (stratpoint:local-agent-check)
 * does the same proof on the server, so a run that skips the form still stops before anything is
 * created.
 *
 * Usage in template.yaml (first parameter page):
 *   localAgent:
 *     title: Your Backstage agent
 *     type: string
 *     ui:field: LocalAgentField
 *     ui:options:
 *       minAgentVersion: 0.1.29   # optional
 */
import React, { useEffect, useState } from 'react';
import { Box, Typography } from '@material-ui/core';
import { AlertCircle, CheckCircle, Loader } from 'lucide-react';
import { useApi, discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { CustomFieldValidator, FieldExtensionComponentProps } from '@backstage/plugin-scaffolder-react';

/** The field's value: READY, UNKNOWN (status API unreachable: the server step still checks), or the problem text. */
const CHECK_EVERY_MS = 5_000;
export const READY = 'ready';
export const UNKNOWN = 'unknown';

interface AgentRow {
  agent_id: string;
  hostname?: string;
  agent_version?: string | null;
  is_connected?: boolean;
  last_seen_age_seconds?: number | null;
}

/** "30 s ago" / "5 min ago" (same wording as the server's stratpoint:local-agent-check). */
function agoText(seconds: number): string {
  return seconds < 90 ? `${Math.round(seconds)} s ago` : `${Math.round(seconds / 60)} min ago`;
}

function versionBelow(a: string | null | undefined, b: string): boolean {
  const pa = /^(\d+)\.(\d+)\.(\d+)$/.exec(a ?? '');
  const pb = /^(\d+)\.(\d+)\.(\d+)$/.exec(b);
  if (!pa || !pb) return false;
  for (let i = 1; i <= 3; i++) {
    if (Number(pa[i]) !== Number(pb[i])) return Number(pa[i]) < Number(pb[i]);
  }
  return false;
}

/** Same rules as the server's agentReadiness (packages/backend/.../localAgent.ts). */
export function agentStatus(agents: AgentRow[], minAgentVersion?: string): { agent?: AgentRow; problem?: string } {
  if (!agents.length) {
    return { problem: "You haven't set up the Backstage agent yet. Labs run on your own laptop through it." };
  }
  // The server's verdict only (it knows when an agent stopped); an age alone lags.
  const online = agents.filter(a => a.is_connected === true);
  if (!online.length) {
    const age = agents[0].last_seen_age_seconds;
    const seen = typeof age === 'number' ? `last seen ${agoText(age)}` : 'never seen';
    return { problem: `Your Backstage agent is offline (${seen}). Start it on your laptop: backstage-agent start` };
  }
  const agent = online[0];
  if (minAgentVersion && versionBelow(agent.agent_version, minAgentVersion)) {
    return { agent, problem: `This lab needs agent ${minAgentVersion} or newer; yours is ${agent.agent_version}. Run: backstage-agent update` };
  }
  return { agent };
}

export const LocalAgentField = ({ onChange, formData, uiSchema }: FieldExtensionComponentProps<string>) => {
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);
  const minAgentVersion = (uiSchema?.['ui:options'] as any)?.minAgentVersion as string | undefined;
  const [agent, setAgent] = useState<AgentRow | undefined>();

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      try {
        const base = await discoveryApi.getBaseUrl('local-provisioner');
        const res = await fetchApi.fetch(`${base}/agent`);
        if (!res.ok) throw new Error(String(res.status));
        const body = await res.json();
        const s = agentStatus(Array.isArray(body.agents) ? body.agents : [], minAgentVersion);
        if (stopped) return;
        setAgent(s.agent);
        onChange(s.problem ?? READY);
      } catch {
        if (stopped) return;
        onChange(UNKNOWN);
      }
      // Keep checking: the form unblocks when the agent starts, and blocks again if it stops.
      if (!stopped) timer = setTimeout(check, CHECK_EVERY_MS);
    };
    check();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discoveryApi, fetchApi, minAgentVersion]);

  const label = (
    <Typography style={{ fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-secondary)' }}>
      Your Backstage agent
    </Typography>
  );
  let body: React.ReactNode;
  if (!formData) {
    body = (
      <Box display="flex" alignItems="center" style={{ gap: 6 }}>
        <Loader size={14} strokeWidth={1.5} aria-hidden="true" />
        <Typography style={{ fontSize: '0.875rem' }}>Checking…</Typography>
      </Box>
    );
  } else if (formData === READY || formData === UNKNOWN) {
    body = (
      <Box display="flex" alignItems="center" style={{ gap: 6 }}>
        <CheckCircle size={14} strokeWidth={2} color="#22c55e" aria-hidden="true" />
        <Typography style={{ fontSize: '0.875rem' }}>
          {formData === READY
            ? `Online${agent?.hostname ? ` on ${agent.hostname}` : ''}${agent?.agent_version ? ` (v${agent.agent_version})` : ''}. Your lab will run there.`
            : 'Couldn’t check your agent from here; it is checked again when you create the lab.'}
        </Typography>
      </Box>
    );
  } else {
    body = (
      <Box role="alert" display="flex" alignItems="flex-start" style={{ gap: 6 }}>
        <AlertCircle size={14} strokeWidth={1.5} color="#e5484d" aria-hidden="true" style={{ marginTop: 2 }} />
        <Typography style={{ color: '#e5484d', fontSize: '0.8125rem' }}>
          {formData}{' '}
          <a href="/local-provisioner" target="_blank" rel="noopener noreferrer">
            Set up or start your agent
          </a>
          . This page checks again every 5 seconds.
        </Typography>
      </Box>
    );
  }
  return (
    <Box style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8, marginBottom: 8 }}>
      {label}
      {body}
    </Box>
  );
};

/**
 * The proven check, run when the user clicks Next: undefined = fine (or can't be checked from here:
 * the server's first step still stops the run), otherwise the problem to show.
 */
async function verifyAgentNow(context: any): Promise<string | undefined> {
  const fetchApi = context?.apiHolder?.get?.(fetchApiRef);
  const discoveryApi = context?.apiHolder?.get?.(discoveryApiRef);
  if (!fetchApi || !discoveryApi) return undefined;
  try {
    const base = await discoveryApi.getBaseUrl('local-provisioner');
    const res = await fetchApi.fetch(`${base}/agent?verify=1`);
    if (!res.ok) return undefined;
    const body = await res.json();
    const minAgentVersion = context?.uiSchema?.['ui:options']?.minAgentVersion as string | undefined;
    return agentStatus(Array.isArray(body.agents) ? body.agents : [], minAgentVersion).problem;
  } catch {
    return undefined;
  }
}

export const validateLocalAgent: CustomFieldValidator<string> = async (data, field, context) => {
  if (!data) {
    field.addError('Still checking your Backstage agent. Wait a moment.');
  } else if (data !== READY && data !== UNKNOWN) {
    field.addError(data);
  } else if (data === READY) {
    // "Online" as of the last 5 s look. This is the moment it matters, so prove it now.
    const problem = await verifyAgentNow(context);
    if (problem) field.addError(problem);
  }
};
