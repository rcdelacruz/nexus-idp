import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import { validate } from 'jsonschema';
import { createTemplateRenderer } from 'nunjitsu';
import { mockServices } from '@backstage/backend-test-utils';
import { createLocalProvisionAction } from './localProvision';
import { createLocalAgentCheckAction } from './localAgent';
import { createCapstoneEnrollAction, createCapstoneLinkRepoAction } from './capstoneEnroll';

/**
 * Renders every engineering-standards template step that calls one of our Local Provisioner
 * actions exactly as the scaffolder does (NunjucksWorkflowRunner.render: renderValue with JSON
 * coercion), then validates it against the action's real input schema. Catches what the action's
 * own unit tests can't: `'${{ parameters.logGb }}'` reaching a string field as a number.
 *
 * Reads the templates from ENGINEERING_STANDARDS_DIR (default: a sibling checkout). Run it before
 * merging a lab template:  CI=true yarn backstage-cli package test labTemplates
 */
const ROOT = process.env.ENGINEERING_STANDARDS_DIR ?? path.resolve(__dirname, '../../../../../../../engineering-standards');
const TEMPLATE_DIRS = ['templates/training', 'templates/projects/local'];

const deps = {
  discovery: { getBaseUrl: async () => 'http://b', getExternalBaseUrl: async () => 'http://portal' } as any,
  auth: { getPluginRequestToken: async () => ({ token: 't' }) } as any,
  config: mockServices.rootConfig({ data: { organization: { domain: 'example.com' }, app: { baseUrl: 'http://portal' } } }),
};
const actions = Object.fromEntries(
  [createLocalProvisionAction(deps), createLocalAgentCheckAction(deps), createCapstoneEnrollAction(deps as any), createCapstoneLinkRepoAction(deps as any)].map(
    a => [a.id, a],
  ),
);

/** A value of the declared type for every template parameter: its default, else the first enum value, else a stand-in. */
function sampleParameters(spec: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const pages = Array.isArray(spec.parameters) ? spec.parameters : [spec.parameters ?? {}];
  for (const page of pages) {
    for (const [name, p] of Object.entries<any>(page.properties ?? {})) {
      if (p.default !== undefined) out[name] = p.default;
      else if (p.enum) out[name] = p.enum[0];
      else if (p.type === 'integer' || p.type === 'number') out[name] = p.minimum ?? 1;
      else if (p.type === 'boolean') out[name] = false;
      else if (p.type === 'array') out[name] = [];
      else if (p.type === 'object') out[name] = {};
      else out[name] = 'sample';
    }
  }
  return out;
}

/** Earlier steps' outputs the template reads (steps.x.output.y / steps['x'].output.y): plain strings, like the real ones. */
function stepOutputs(templateText: string): Record<string, { output: Record<string, string> }> {
  const steps: Record<string, { output: Record<string, string> }> = {};
  for (const m of templateText.matchAll(/steps(?:\.([\w-]+)|\[['"]([\w-]+)['"]\])\.output\.(\w+)/g)) {
    const id = m[1] ?? m[2];
    (steps[id] ??= { output: {} }).output[m[3]] = `sample-${m[3]}`;
  }
  return steps;
}

function templates(): string[] {
  const found: string[] = [];
  for (const dir of TEMPLATE_DIRS) {
    const base = path.join(ROOT, dir);
    if (!fs.existsSync(base)) continue;
    for (const lab of fs.readdirSync(base)) {
      const f = path.join(base, lab, 'template.yaml');
      if (fs.existsSync(f)) found.push(f);
    }
  }
  return found;
}

/** A page whose only job is the TemplateOverview field. */
function isOverviewPage(page: any): boolean {
  return Object.values<any>(page?.properties ?? {}).some(p => p?.['ui:field'] === 'TemplateOverview');
}

const files = templates();
const maybe = files.length ? describe : describe.skip;

maybe(`lab templates render to valid action input (${ROOT})`, () => {
  const renderer = createTemplateRenderer({ allowRegexExecution: true });
  const cases = files.flatMap(f => {
    const text = fs.readFileSync(f, 'utf8');
    const t = yaml.parse(text);
    return (t.spec?.steps ?? [])
      .filter((s: any) => actions[s.action])
      .map((s: any) => [`${path.basename(path.dirname(f))} › ${s.id} (${s.action})`, t, s, text] as const);
  });

  it('finds the lab templates', () => {
    expect(cases.length).toBeGreaterThan(5);
  });

  // Guardrail: a lab template must stop before it creates anything (a repo, an enrollment, a
  // trainee number) when the user's agent isn't set up or running — so the agent check is step 1.
  it.each(files.map(f => [path.basename(path.dirname(f)), f] as const))('%s checks the agent first', (_name, f) => {
    const steps: any[] = yaml.parse(fs.readFileSync(f, 'utf8')).spec?.steps ?? [];
    if (!steps.some(st => st.action === 'stratpoint:local-provision')) return;
    expect(steps[0]?.action).toBe('stratpoint:local-agent-check');
    // The form shows the same check before the trainee can continue: on the first page that asks
    // anything (an Overview page in front of it only shows text).
    const pages = yaml.parse(fs.readFileSync(f, 'utf8')).spec?.parameters ?? [];
    const list: any[] = Array.isArray(pages) ? pages : [pages];
    const first = isOverviewPage(list[0]) ? list[1] : list[0];
    expect(Object.values<any>(first?.properties ?? {}).some(p => p['ui:field'] === 'LocalAgentField')).toBe(true);
  });

  // Guardrail: when a lab run succeeds, the Create run page sends the user to their lab (and opens
  // its drawer) by following the output link on the queue step's taskUrl (CustomTaskPage). So the
  // step that queues the lab is called queue-task, is the LAST step (a step after it could fail and
  // leave a queued lab on a run that ends in an error, with no link), and the output links to its
  // taskUrl. A template that drops any of these silently loses the redirect.
  const labTemplates = files.filter(f => (yaml.parse(fs.readFileSync(f, 'utf8')).spec?.steps ?? []).some((st: any) => st.action === 'stratpoint:local-provision'));

  it('finds the templates that queue a lab', () => {
    expect(labTemplates.length).toBeGreaterThanOrEqual(12);
  });

  it.each(labTemplates.map(f => [path.basename(path.dirname(f)), f] as const))('%s queues the lab in its last step and links its output to the lab', (_name, f) => {
    const t = yaml.parse(fs.readFileSync(f, 'utf8'));
    const steps: any[] = t.spec.steps;
    const queue = steps.filter(st => st.action === 'stratpoint:local-provision');
    expect(queue.map(st => st.id)).toEqual(['queue-task']);
    expect(steps[steps.length - 1].id).toBe('queue-task');
    const urls = (t.spec.output?.links ?? []).map((l: any) => l.url);
    expect(urls).toContain("${{ steps['queue-task'].output.taskUrl }}");
  });

  // The Overview page (TemplateOverview field) is text only: it must be the first page, hold nothing
  // else, ask for nothing, and use only options the field reads, as the right kind of value. A
  // misspelt option would otherwise just silently not show.
  it.each(files.map(f => [path.basename(path.dirname(f)), f] as const))('%s has a well-formed Overview page', (_name, f) => {
    const pages = yaml.parse(fs.readFileSync(f, 'utf8')).spec?.parameters ?? [];
    const list: any[] = Array.isArray(pages) ? pages : [pages];
    const overviewIndexes = list.map((p, i) => (isOverviewPage(p) ? i : -1)).filter(i => i >= 0);
    if (overviewIndexes.length === 0) return;
    expect(overviewIndexes).toEqual([0]);
    const page = list[0];
    expect(Object.keys(page.properties)).toEqual(['overview']);
    expect(page.required).toBeUndefined();
    const options = page.properties.overview['ui:options'] ?? {};
    const known = ['format', 'runsOn', 'gradedBy', 'alsoNeed', 'summary', 'listTitle', 'list', 'onCreate'];
    const problems: string[] = [];
    for (const k of Object.keys(options)) {
      if (!known.includes(k)) problems.push(`unknown option "${k}"`);
    }
    for (const k of ['format', 'runsOn', 'gradedBy', 'alsoNeed', 'summary', 'listTitle']) {
      if (k in options && !(typeof options[k] === 'string' && options[k].trim() !== '')) problems.push(`"${k}" must be a non-empty string`);
    }
    for (const k of ['list', 'onCreate']) {
      const v = options[k];
      if (k in options && !(Array.isArray(v) && v.length > 0 && v.every((x: unknown) => typeof x === 'string' && x.trim() !== ''))) {
        problems.push(`"${k}" must be a list of non-empty strings`);
      }
    }
    if ('listTitle' in options && !('list' in options)) problems.push('"listTitle" without a "list"');
    expect(problems).toEqual([]);
  });

  it.each(cases)('%s', (_name, t, step, text) => {
    const context = {
      parameters: sampleParameters(t.spec),
      steps: stepOutputs(text),
      user: { ref: 'user:default/sample', entity: { metadata: { name: 'sample' }, spec: { profile: { email: 'sample@example.com' } } } },
      secrets: {},
    };
    // Same as NunjucksWorkflowRunner.render.
    const input = JSON.parse(JSON.stringify(step.input ?? {}), (_k, v) =>
      typeof v === 'string' ? renderer.renderValue(v, context, { coercion: 'json' }) : v,
    );
    const result = validate(input, actions[step.action].schema!.input as any);
    expect(result.errors.map(e => e.stack)).toEqual([]);
  });
});
