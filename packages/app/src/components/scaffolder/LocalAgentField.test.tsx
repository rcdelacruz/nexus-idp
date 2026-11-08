import React from 'react';
import { act, screen } from '@testing-library/react';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { LocalAgentField, READY, UNKNOWN, agentStatus, validateLocalAgent } from './LocalAgentField';

const renderWith = async (respond: () => Promise<any>, minAgentVersion?: string) => {
  let value: string | undefined;
  await renderInTestApp(
    <TestApiProvider apis={[[discoveryApiRef, { getBaseUrl: async () => 'http://lp' }], [fetchApiRef, { fetch: respond }]]}>
      <Field minAgentVersion={minAgentVersion} onValue={v => (value = v)} />
    </TestApiProvider>,
  );
  return () => value;
};
const agents = (list: any[]) => async () => ({ ok: true, json: async () => ({ agents: list }) });

/** The real field, re-rendered with whatever it reports through onChange (like the scaffolder form). */
function Field({ onValue, minAgentVersion }: { onValue: (v: string) => void; minAgentVersion?: string }) {
  const [v, setV] = React.useState<string | undefined>(undefined);
  return (
    <LocalAgentField
      {...({} as any)}
      uiSchema={{ 'ui:options': { minAgentVersion } }}
      formData={v}
      onChange={(next: string) => {
        setV(next);
        onValue(next);
      }}
    />
  );
}

describe('LocalAgentField', () => {
  it('online: says where the lab will run, and lets the form continue', async () => {
    const value = await renderWith(agents([{ agent_id: 'a', hostname: 'ronalds-mac', agent_version: '0.1.30', is_connected: true }]));
    expect(await screen.findByText(/Online on ronalds-mac \(v0\.1\.30\)/)).toBeInTheDocument();
    expect(value()).toBe(READY);
  });

  it('not set up: blocks with a link to set it up', async () => {
    const value = await renderWith(agents([]));
    expect(await screen.findByRole('alert')).toHaveTextContent(/haven't set up the Backstage agent/);
    expect(screen.getByText('Set up or start your agent').closest('a')).toHaveAttribute('href', '/local-provisioner');
    expect(value()).toMatch(/haven't set up/);
  });

  it('offline: blocks and says how to start it', async () => {
    await renderWith(agents([{ agent_id: 'a', is_connected: false, last_seen_age_seconds: 7200 }]));
    expect(await screen.findByRole('alert')).toHaveTextContent(/offline \(last seen 120 min ago\).*backstage-agent start/);
  });

  it('too old for this lab: blocks and says how to update', async () => {
    await renderWith(agents([{ agent_id: 'a', agent_version: '0.1.28', is_connected: true }]), '0.1.29');
    expect(await screen.findByRole('alert')).toHaveTextContent(/needs agent 0\.1\.29 or newer; yours is 0\.1\.28/);
  });

  it("status API unreachable: doesn't block (the template's first step checks on the server)", async () => {
    const value = await renderWith(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    expect(await screen.findByText(/checked again when you create the lab/)).toBeInTheDocument();
    expect(value()).toBe(UNKNOWN);
  });

  it('blocks again when the agent stops after the page opened (keeps checking)', async () => {
    jest.useFakeTimers();
    try {
      let on = true;
      const value = await renderWith(async () => ({ ok: true, json: async () => ({ agents: [{ agent_id: 'a', is_connected: on }] }) }));
      expect(await screen.findByText(/^Online/)).toBeInTheDocument();
      expect(value()).toBe(READY);
      on = false;
      await act(async () => {
        jest.advanceTimersByTime(5_000); // looks again every 5 s (was 15 s while online)
      });
      expect(await screen.findByRole('alert')).toHaveTextContent(/offline/);
      expect(value()).toMatch(/offline/);
    } finally {
      jest.useRealTimers();
    }
  });

  it('validation: blocks everything except ready / unknown', async () => {
    const errors: string[] = [];
    const field = { addError: (e: string) => errors.push(e) } as any;
    await validateLocalAgent(READY, field, {} as any); // nothing to verify with: the server step still checks
    await validateLocalAgent(UNKNOWN, field, {} as any);
    expect(errors).toEqual([]);
    await validateLocalAgent('', field, {} as any);
    await validateLocalAgent('Your Backstage agent is offline', field, {} as any);
    expect(errors).toEqual(['Still checking your Backstage agent. Wait a moment.', 'Your Backstage agent is offline']);
    // Seen 20 s ago but not connected (it just stopped): blocked. Only the server's verdict counts.
    expect(agentStatus([{ agent_id: 'a', is_connected: false, last_seen_age_seconds: 20 }]).problem).toMatch(/offline \(last seen 20 s ago\)/);
  });

  describe('Next proves the agent is alive right now (the 5 s look can trail a vanished agent)', () => {
    const contextFor = (respond: (url: string) => Promise<any>, urls: string[] = []) =>
      ({
        uiSchema: { 'ui:options': {} },
        apiHolder: {
          get: (ref: any) =>
            ref === fetchApiRef
              ? {
                  fetch: async (url: string) => {
                    urls.push(url);
                    return respond(url);
                  },
                }
              : { getBaseUrl: async () => 'http://lp' },
        },
      }) as any;
    const run = async (context: any) => {
      const errors: string[] = [];
      await validateLocalAgent(READY, { addError: (e: string) => errors.push(e) } as any, context);
      return errors;
    };

    it('blocks Next when the server (verify=1) could not get an answer from the agent', async () => {
      const urls: string[] = [];
      const errors = await run(
        contextFor(async () => ({ ok: true, json: async () => ({ agents: [{ agent_id: 'a', is_connected: false, last_seen_age_seconds: 12 }] }) }), urls),
      );
      expect(urls).toEqual(['http://lp/agent?verify=1']);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/offline \(last seen 12 s ago\).*backstage-agent start/);
    });

    it('lets Next through when the agent answers', async () => {
      const errors = await run(contextFor(async () => ({ ok: true, json: async () => ({ agents: [{ agent_id: 'a', is_connected: true }] }) })));
      expect(errors).toEqual([]);
    });

    it("does not block when it can't be checked from here (the template's first step still does)", async () => {
      expect(await run(contextFor(async () => ({ ok: false, status: 503, json: async () => ({}) })))).toEqual([]);
      expect(await run(contextFor(async () => { throw new Error('network'); }))).toEqual([]);
    });
  });
});
