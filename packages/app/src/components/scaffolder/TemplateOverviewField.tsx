/**
 * TemplateOverviewField — the first step of a template's wizard: what this template is and what
 * pressing Create does, before the user fills in anything. Nothing here is specific to labs: any
 * template can opt in by adding the page below; one that does not keeps its wizard as it is.
 *
 * Two sources, on purpose:
 *  - read from the template itself, so they cannot drift from what it really needs: the full
 *    description, the tags, and "You need" (the agent version and Docker memory come from the
 *    template's own `stratpoint:local-agent-check` step);
 *  - written in the template's `ui:options`, for what only the template's author knows (format, what you
 *    will build, how it is graded, what Create does in plain words).
 * A template that writes nothing still gets a useful step: its description, the requirements and tags.
 *
 * Usage in template.yaml (its own first parameter page, titled "Overview"):
 *   overview:
 *     type: string
 *     ui:field: TemplateOverview
 *     ui:options:
 *       format: 5 days, solo
 *       runsOn: Your laptop, on your own local MiniStack
 *       gradedBy: Hidden checks ..., and by how you worked.
 *       alsoNeed: Multipass.                 # optional, added to "You need"
 *       summary: ...                         # optional paragraph
 *       listTitle: What you will build       # optional; the default is "What you get"
 *       list: [ ... ]                        # bullets
 *       onCreate: [ ... ]                    # steps after "Your Backstage agent is checked."
 *
 * The field never sets a value, so the wizard's Review page does not list it.
 */
import React from 'react';
import { useParams } from 'react-router-dom';
import useAsync from 'react-use/lib/useAsync';
import { Entity, stringifyEntityRef } from '@backstage/catalog-model';
import { useApi } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import { FieldExtensionComponentProps } from '@backstage/plugin-scaffolder-react';
import { useColors } from '@stratpoint/theme-utils';

export interface TemplateOverviewOptions {
  format?: string;
  runsOn?: string;
  gradedBy?: string;
  alsoNeed?: string;
  summary?: string;
  listTitle?: string;
  list?: string[];
  onCreate?: string[];
}

export interface OverviewModel {
  /** The paragraph above the facts: the authored summary, else the description when the author wrote no list. */
  summary?: string;
  facts: { label: string; value: string }[];
  listTitle: string;
  list: string[];
  onCreate: string[];
  tags: string[];
}

const AGENT_CHECK = 'stratpoint:local-agent-check';
const LOCAL_PROVISION = 'stratpoint:local-provision';

const texts = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map(x => x.trim()) : [];
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);

/** What the lab needs on the user's machine, read from the template's own agent-check step. */
function youNeed(steps: any[], alsoNeed?: string): string | undefined {
  const parts: string[] = [];
  const check = steps.find(s => s?.action === AGENT_CHECK);
  if (check) {
    const version = text(check.input?.minAgentVersion);
    parts.push(`Backstage agent${version ? ` ${version} or newer` : ''}, online.`);
    const gb = Number(check.input?.requirements?.minDockerMemoryGb);
    if (Number.isFinite(gb) && gb > 0) parts.push(`Docker with at least ${gb} GB of memory.`);
  }
  if (alsoNeed) parts.push(alsoNeed.endsWith('.') ? alsoNeed : `${alsoNeed}.`);
  return parts.length ? parts.join(' ') : undefined;
}

export function buildOverview(options: TemplateOverviewOptions | undefined, entity: Entity | undefined): OverviewModel {
  const o = options ?? {};
  const steps: any[] = Array.isArray((entity?.spec as any)?.steps) ? (entity!.spec as any).steps : [];
  const hasAgentCheck = steps.some(s => s?.action === AGENT_CHECK);
  const runsLocally = steps.some(s => s?.action === LOCAL_PROVISION);

  const format = text(o.format);
  const gradedBy = text(o.gradedBy);
  const list = texts(o.list);
  const authoredOnCreate = texts(o.onCreate);
  // The description is the fallback for "what is it": shown unless the author wrote their own summary or list.
  const describesItself = !!text(o.summary) || list.length > 0;

  const facts: OverviewModel['facts'] = [];
  if (format) facts.push({ label: 'Format', value: format });
  const runsOn = text(o.runsOn) ?? (runsLocally ? 'Your laptop' : undefined);
  if (runsOn) facts.push({ label: 'Runs on', value: runsOn });
  const need = youNeed(steps, text(o.alsoNeed));
  if (need) facts.push({ label: 'You need', value: need });
  if (gradedBy) facts.push({ label: 'Graded by', value: gradedBy });

  return {
    summary: text(o.summary) ?? (describesItself ? undefined : text(entity?.metadata?.description)),
    facts,
    listTitle: text(o.listTitle) ?? 'What you get',
    list,
    onCreate: [...(hasAgentCheck ? ['Your Backstage agent is checked.'] : []), ...authoredOnCreate],
    tags: Array.isArray(entity?.metadata?.tags) ? entity!.metadata.tags!.filter(t => typeof t === 'string') : [],
  };
}

export const TemplateOverviewField = ({ uiSchema }: FieldExtensionComponentProps<string>) => {
  const c = useColors();
  const catalogApi = useApi(catalogApiRef);
  const { templateName, namespace } = useParams();

  const { value: entity, loading, error } = useAsync(async () => {
    if (!templateName) return undefined;
    return catalogApi.getEntityByRef(
      stringifyEntityRef({ kind: 'Template', namespace: namespace ?? 'default', name: templateName }),
    );
  }, [catalogApi, templateName, namespace]);
  // What the author wrote still shows; only the parts read from the template are missing, and the
  // user is told so rather than left to think the lab needs nothing.
  const unreadable = !loading && !!templateName && (!!error || !entity);

  const model = buildOverview(uiSchema?.['ui:options'] as TemplateOverviewOptions | undefined, entity);

  const micro: React.CSSProperties = {
    fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: c.textMuted,
  };
  const body: React.CSSProperties = { fontSize: '0.875rem', lineHeight: 1.5, color: c.text };
  const list: React.CSSProperties = { margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4, ...body };
  const heading: React.CSSProperties = { ...micro, margin: 0 };
  const divider = <div style={{ height: 1, background: c.borderSubtle }} />;

  const sections: React.ReactNode[] = [];
  if (model.summary) {
    sections.push(<div key="summary" style={{ ...body, lineHeight: 1.6, maxWidth: 760 }}>{model.summary}</div>);
  }
  if (model.facts.length) {
    sections.push(
      <dl key="facts" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '16px 24px', margin: 0 }}>
        {model.facts.map(f => (
          <div key={f.label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <dt style={micro}>{f.label}</dt>
            <dd style={{ ...body, margin: 0 }}>{f.value}</dd>
          </div>
        ))}
      </dl>,
    );
  }
  if (model.list.length) {
    sections.push(
      <section key="list" aria-labelledby="overview-list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h3 id="overview-list" style={heading}>{model.listTitle}</h3>
        <ul style={list}>{model.list.map(item => <li key={item}>{item}</li>)}</ul>
      </section>,
    );
  }
  if (model.onCreate.length) {
    sections.push(
      <section key="create" aria-labelledby="overview-create" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h3 id="overview-create" style={heading}>What happens when you press Create</h3>
        <ol style={list}>{model.onCreate.map(item => <li key={item}>{item}</li>)}</ol>
      </section>,
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {sections.flatMap((s, i) => (i === 0 ? [s] : [React.cloneElement(divider, { key: `d${i}` }), s]))}
      {unreadable && (
        <div role="note" style={{ fontSize: '0.8125rem', color: c.textMuted }}>
          This template could not be read just now, so what it needs and its tags are not shown here. Your agent is
          checked again when you create it.
        </div>
      )}
      {model.tags.length > 0 && (
        <ul aria-label="Tags" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: 0, padding: 0, listStyle: 'none' }}>
          {model.tags.map(t => (
            <li
              key={t}
              style={{ border: `1px solid ${c.border}`, borderRadius: 100, padding: '5px 12px', fontSize: '0.75rem', color: c.textSecondary }}
            >
              {t}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
