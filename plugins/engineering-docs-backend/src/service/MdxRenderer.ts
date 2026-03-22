import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// ─── Slugify (must match frontend DocTOC.slugify) ────────────────────────────

// Must match DocTOC.slugify exactly for TOC anchor links to work
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (React.isValidElement(node)) {
    return extractText((node.props as any).children);
  }
  return '';
}

// ─── Heading with id ─────────────────────────────────────────────────────────

function makeHeading(level: number) {
  return ({ children, ...props }: any) => {
    const id = slugify(extractText(children));
    return React.createElement(`h${level}`, { id, ...props }, children);
  };
}

// ─── Callout ─────────────────────────────────────────────────────────────────

const CALLOUT_META: Record<string, { icon: string; label: string }> = {
  default:   { icon: 'ℹ️',  label: 'Note' },
  info:      { icon: 'ℹ️',  label: 'Info' },
  note:      { icon: 'ℹ️',  label: 'Note' },
  tip:       { icon: '💡', label: 'Tip' },
  warning:   { icon: '⚠️', label: 'Warning' },
  caution:   { icon: '🔴', label: 'Caution' },
  error:     { icon: '🚨', label: 'Error' },
  important: { icon: '📌', label: 'Important' },
};

const Callout = ({ type = 'default', emoji, title, children }: { type?: string; emoji?: string; title?: string; children?: React.ReactNode }) => {
  const key = (type ?? 'default').toLowerCase();
  const { icon, label } = CALLOUT_META[key] ?? CALLOUT_META.default;
  const displayTitle = title ?? label;
  return React.createElement(
    'div',
    { className: `nh-callout nh-callout-${key}` },
    React.createElement('div', { className: 'nh-callout-title' }, emoji ?? icon, '\u00a0', displayTitle),
    children ? React.createElement('div', { className: 'nh-callout-body' }, children) : null,
  );
};

// ─── Steps ───────────────────────────────────────────────────────────────────

const Steps = ({ children }: { children?: React.ReactNode }) => {
  const childArr = React.Children.toArray(children);
  const steps: React.ReactNode[][] = [];
  let current: React.ReactNode[] = [];

  for (const child of childArr) {
    // h3 elements have type === 'h3' when not overridden in components
    if (React.isValidElement(child) && child.type === 'h3') {
      if (current.length) steps.push(current);
      current = [child];
    } else {
      current.push(child);
    }
  }
  if (current.length) steps.push(current);

  // Fallback: no h3 headings found — just render children normally
  if (steps.length <= 1 && !steps[0]?.some(c => React.isValidElement(c) && c.type === 'h3')) {
    return React.createElement('div', { className: 'nh-steps' }, children);
  }

  return React.createElement(
    'div',
    { className: 'nh-steps' },
    ...steps.map((step, i) =>
      React.createElement(
        'div',
        { key: i, className: 'nh-step' },
        React.createElement(
          'div',
          { className: 'nh-step-indicator' },
          React.createElement('div', { className: 'nh-step-number' }, i + 1),
          i < steps.length - 1 ? React.createElement('div', { className: 'nh-step-line' }) : null,
        ),
        React.createElement('div', { className: 'nh-step-content' }, ...step),
      ),
    ),
  );
};

// ─── FileTree ─────────────────────────────────────────────────────────────────

const FileTreeFolder = ({ name, children }: { name?: string; children?: React.ReactNode }) =>
  React.createElement(
    'div',
    { className: 'nh-filetree-folder' },
    React.createElement('div', { className: 'nh-filetree-folder-name' }, '📁\u00a0', name),
    children ? React.createElement('div', { className: 'nh-filetree-children' }, children) : null,
  );

const FileTreeFile = ({ name }: { name?: string }) =>
  React.createElement('div', { className: 'nh-filetree-file' }, '📄\u00a0', name);

const FileTree = Object.assign(
  ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', { className: 'nh-filetree' }, children),
  { Folder: FileTreeFolder, File: FileTreeFile },
);

// ─── Tabs / Tab ───────────────────────────────────────────────────────────────
// SSR: render all tabs stacked with labels (no interactivity)

const Tab = ({ label, children }: { label?: string; children?: React.ReactNode }) =>
  React.createElement(
    'div',
    { className: 'nh-tab' },
    label ? React.createElement('div', { className: 'nh-tab-label' }, label) : null,
    React.createElement('div', { className: 'nh-tab-content' }, children),
  );

const Tabs = Object.assign(
  ({ items, children }: { items?: string[]; children?: React.ReactNode }) => {
    const childArr = React.Children.toArray(children);
    const tabs = items?.length
      ? items.map((label, i) => React.createElement(Tab, { key: i, label }, childArr[i]))
      : childArr;
    return React.createElement('div', { className: 'nh-tabs' }, ...tabs);
  },
  { Tab },
);

// ─── Cards / Card ─────────────────────────────────────────────────────────────

const Card = ({ title, children }: { title?: string; children?: React.ReactNode; href?: string }) =>
  React.createElement(
    'div',
    { className: 'nh-card' },
    title ? React.createElement('div', { className: 'nh-card-title' }, title) : null,
    children ? React.createElement('div', { className: 'nh-card-body' }, children) : null,
  );

const Cards = Object.assign(
  ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', { className: 'nh-cards' }, children),
  { Card },
);

// ─── Pre — marks code blocks for client-side syntax highlighting ──────────────

const Pre = ({ children }: { children?: React.ReactNode }) => {
  const child = React.Children.only(children) as React.ReactElement<any>;
  const className = (child?.props as any)?.className || '';
  const lang = /language-(\w+)/.exec(className)?.[1] ?? 'text';
  // Extract title from MkDocs superfence: `python title="file.py"` → className contains the full info string
  const titleMatch = /title="([^"]*)"/.exec(className) ?? /title='([^']*)'/.exec(className);
  const title = titleMatch?.[1];
  return React.createElement(
    'pre',
    { 'data-code-block': 'true', 'data-language': lang, ...(title ? { 'data-title': title } : {}) },
    children,
  );
};

// ─── compileMdxToHtml ─────────────────────────────────────────────────────────

// Fallback for unknown MDX components: render children or nothing
const Unknown = ({ children }: { children?: React.ReactNode }) =>
  children ? React.createElement(React.Fragment, null, children) : null;

// ─── Docusaurus aliases ───────────────────────────────────────────────────────

// Admonition maps to Callout (type prop is identical: note/tip/info/warning/caution)
const Admonition = Callout;

// TabItem maps to Tab (Docusaurus uses value+label, Nextra uses label only)
const TabItem = ({ label, value, children }: { label?: string; value?: string; children?: React.ReactNode }) =>
  React.createElement(Tab, { label: label ?? value }, children);

const KNOWN_COMPONENTS = {
  h1: makeHeading(1),
  h2: makeHeading(2),
  h3: makeHeading(3),
  h4: makeHeading(4),
  pre: Pre,
  // Nextra components
  Callout,
  Steps,
  FileTree,
  Tabs,
  Tab,
  Cards,
  Card,
  // Docusaurus aliases
  Admonition,
  TabItem,
};

// Proxy that returns Unknown for any component not in the known map
const componentsProxy = new Proxy(KNOWN_COMPONENTS as Record<string, any>, {
  get(target, key: string) {
    return key in target ? target[key] : Unknown;
  },
  has(_target, _key) {
    return true;
  },
});

export async function compileMdxToHtml(mdxContent: string): Promise<string> {
  // Dynamic imports — these are ESM-only packages; works fine in Node.js 20
  const { compile, run } = await import('@mdx-js/mdx');
  const { jsx, jsxs, Fragment } = await import('react/jsx-runtime') as any;
  const { default: remarkGfm } = await import('remark-gfm') as any;

  const compiled = await compile(mdxContent, {
    outputFormat: 'function-body',
    remarkPlugins: [remarkGfm],
  });

  const { default: MDXContent } = await run(compiled, { jsx, jsxs, Fragment } as any);

  return renderToStaticMarkup(
    React.createElement(MDXContent as any, { components: componentsProxy }),
  );
}
