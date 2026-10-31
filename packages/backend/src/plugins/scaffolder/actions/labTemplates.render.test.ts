import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import { validate } from 'jsonschema';
import { createTemplateRenderer } from 'nunjitsu';
import { mockServices } from '@backstage/backend-test-utils';
import { createLocalProvisionAction } from './localProvision';
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
  [createLocalProvisionAction(deps), createCapstoneEnrollAction(deps as any), createCapstoneLinkRepoAction(deps as any)].map(a => [a.id, a]),
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
