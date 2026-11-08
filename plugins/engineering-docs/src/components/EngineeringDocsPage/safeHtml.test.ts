/* eslint-disable no-script-url -- the point of these tests is documents that contain script URLs */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
// eslint-disable-next-line @backstage/no-undeclared-imports -- test-only: the root devDependency transpiles the plugin for the child process
import ts from 'typescript';
import { isSafeStyleDeclaration, isSafeUrl, rehypeSafeHtml, safeStyleText } from './safeHtml';

jest.setTimeout(120_000);

const el = (tagName: string, properties: Record<string, unknown> = {}, children: any[] = []) => ({ type: 'element', tagName, properties, children });
const clean = (children: any[]) => {
  const tree: any = { type: 'root', children };
  rehypeSafeHtml()(tree);
  return tree.children;
};

describe('rehypeSafeHtml (tree level)', () => {
  it.each(['script', 'IFRAME', 'object', 'embed', 'form', 'style', 'link', 'meta', 'base', 'template', 'foreignObject', 'animate', 'set', 'animateTransform', 'mpath', 'discard'])(
    'removes <%s> with its content, wherever it is nested',
    tag => {
      const out = clean([el('div', {}, [el('p', {}, [el(tag, {}, [{ type: 'text', value: 'x' }])]), el('p')])]);
      expect(out[0].children[0].children).toEqual([]);
      expect(out[0].children).toHaveLength(2);
    },
  );

  it('removes on* handlers, srcdoc and script-scheme values; keeps the rest', () => {
    const [a] = clean([el('a', { href: 'javascript:alert(1)', title: 't', onClick: 'x', onerror: 'x', srcDoc: '<p>', className: ['a', 'b'] })]);
    expect(a.properties).toEqual({ title: 't', className: ['a', 'b'] });
  });

  it.each([
    ['href', '  JaVa\tScRiPt:alert(1)'],
    ['href', 'data:text/html;base64,AAAA'],
    ['src', 'data:image/svg+xml;base64,AAAA'],
    ['xLinkHref', 'javascript:x'],
    ['values', 'a;javascript:alert(1)'],
    ['to', 'javascript:alert(1)'],
    ['srcSet', 'a.png 1x, javascript:x 2x'],
    ['link', 'vbscript:x'],
  ])('removes %s=%j', (name, value) => {
    const [e] = clean([el('x-el', { [name]: value, id: 'keep' })]);
    expect(e.properties).toEqual({ id: 'keep' });
  });

  it('keeps text attributes that read like a scheme, and drops the same words in an attribute that could be a link', () => {
    const [e] = clean([el('img', { alt: 'JavaScript: tips', title: 'vbscript: how-to', ariaLabel: 'JavaScript: x', dataNote: 'javascript: y', link: 'javascript:alert(1)' })]);
    expect(e.properties).toEqual({ alt: 'JavaScript: tips', title: 'vbscript: how-to', ariaLabel: 'JavaScript: x', dataNote: 'javascript: y' });
  });

  it.each([
    ['href', 'https://example.com/a'],
    ['href', '../other.md#x'],
    ['href', 'mailto:a@b.co'],
    ['src', 'data:image/png;base64,iVBORw0KGgo='],
    ['alt', 'Data: the results'],
    ['title', 'JavaScript tutorial: part 1'],
  ])('keeps %s=%j', (name, value) => {
    const [e] = clean([el('img', { [name]: value })]);
    expect(e.properties).toEqual({ [name]: value });
  });
});

describe('style: ordinary styling stays, anything that can cover or restyle the portal goes', () => {
  it.each([
    ['color: red; font-weight: bold', 'color: red; font-weight: bold'],
    ['text-align:center;max-width:100%;margin:0 auto', 'text-align:center; max-width:100%; margin:0 auto'],
    ['width: 50%; padding: 8px 12px; background: #eee', 'width: 50%; padding: 8px 12px; background: #eee'],
    ['position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 99999', 'width: 100vw; height: 100vh'],
    ['POSITION:ABSOLUTE;color:red', 'color:red'],
    ['transform: translate(-50%,-50%); color: red', 'color: red'],
    ['margin-left: -9999px; color: red', 'color: red'],
    ['margin: 0 -50px', ''],
    ['background: url(https://evil.example/track.png)', ''],
    ['background-image: image-set("a.png" 1x)', ''],
    ['width: expression(alert(1))', ''],
    ['b\\61 ckground: red', ''],
    ['p\\6f sition: fixed; color: red', 'color: red'],
    ['Position: Fixed', ''],
    ['Z-Index: 9', ''],
    ['float: left; pointer-events: none; content: "x"; inset: 0', ''],
  ])('%j -> %j', (css, kept) => {
    expect(safeStyleText(css)).toBe(kept);
  });

  it('judges camelCase names the way the MDX style object spells them', () => {
    expect(isSafeStyleDeclaration('zIndex', '9')).toBe(false);
    expect(isSafeStyleDeclaration('pointerEvents', 'none')).toBe(false);
    expect(isSafeStyleDeclaration('marginLeft', '-10px')).toBe(false);
    expect(isSafeStyleDeclaration('textAlign', 'center')).toBe(true);
  });

  it('cleans the style property of an element, and removes it when nothing is left', () => {
    const [a, b] = clean([el('div', { style: 'color:red; position:fixed' }), el('div', { style: 'position:fixed; inset:0' })]);
    expect(a.properties).toEqual({ style: 'color:red' });
    expect(b.properties).toEqual({});
  });
});

describe('isSafeUrl', () => {
  it.each(['', 'a/b', '//cdn.example.com/x.js', 'HTTPS://X.COM', 'git@github.com:a/b']) ('allows %j', u => expect(isSafeUrl(u)).toBe(true));
  it.each(['javascript:1', ' javascript:1', 'JAVASCRIPT:1', 'java\u0000script:1', 'vbscript:1', 'data:text/html,1'])('refuses %j', u => expect(isSafeUrl(u)).toBe(false));
});

// ── End to end: the real react-markdown + rehype-raw, in a child Node process (ESM-only packages) ─────────────────────────────

const pluginDir = path.resolve(__dirname, '../../..');
const tmpDir = path.join(pluginDir, '.safehtml-e2e-tmp');

function render(docs: string[], guard: boolean): string[] {
  const out = execFileSync(process.execPath, [path.join(tmpDir, 'runner.mjs'), guard ? 'guard' : 'noguard'], {
    cwd: pluginDir,
    input: JSON.stringify(docs),
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out.toString());
}

beforeAll(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
  const source = fs.readFileSync(path.join(__dirname, 'safeHtml.ts'), 'utf8');
  fs.writeFileSync(path.join(tmpDir, 'safeHtml.mjs'), ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText);
  // The same plugins as DocViewer's fallback: remarkGfm, then rehypeRaw (+ rehypeSafeHtml).
  fs.writeFileSync(
    path.join(tmpDir, 'runner.mjs'),
    `import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { rehypeSafeHtml } from './safeHtml.mjs';
const { renderToStaticMarkup } = await import('react-dom/server');
const guard = process.argv[2] === 'guard';
const chunks = []; for await (const c of process.stdin) chunks.push(c);
const docs = JSON.parse(Buffer.concat(chunks).toString());
process.stdout.write(JSON.stringify(docs.map(d => renderToStaticMarkup(React.createElement(ReactMarkdown, { remarkPlugins: [remarkGfm], rehypePlugins: guard ? [rehypeRaw, rehypeSafeHtml] : [rehypeRaw] }, d)))));
`,
  );
});
afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

// Documents that make the backend's MDX compile fail (a stray "{" or a style string), so the viewer falls back to this renderer.
const HOSTILE = [
  'a stray { brace\n\n<iframe srcdoc="<script>parent.document.title=1</script>"></iframe>',
  'x {\n\n<svg><a href="#"><animate attributeName="href" values="javascript:alert(1)"/><text>click</text></a></svg>',
  'x {\n\n<svg><a href="#"><set attributeName="href" to="javascript:alert(1)"/><text>click</text></a></svg>',
  'x {\n\n<form action="https://evil.example"><input name="password"></form>',
  'x {\n\n<meta http-equiv="refresh" content="0;url=https://evil.example">',
  'x {\n\n<img src="/a.png" onerror="alert(1)">',
  'x {\n\n[click](javascript:alert(1)) <a href="JaVa&#x09;Script:alert(1)">x</a>',
  'x {\n\n<style>body{display:none}</style><object data="https://evil.example/x.swf"></object>',
];

describe('the docs fallback renderer (child process)', () => {
  it('the harness really shows the hostile content when the guard is off (so the checks below are not vacuous)', () => {
    const html = render(HOSTILE, false).join('\n');
    expect(html).toMatch(/<iframe/);
    expect(html).toMatch(/<animate/);
    expect(html).toMatch(/javascript:/i); // (React itself already drops on* handler props, so onerror is not the evidence)
  });

  it('with the guard, nothing that can run survives', () => {
    for (const html of render(HOSTILE, true)) {
      expect(html).not.toMatch(/<iframe|<animate|<set\b|<form|<input|<meta|<style|<object|<script|srcdoc|onerror|javascript:/i);
    }
  });

  it('with the guard, ordinary documentation renders exactly as before', () => {
    const docs = [
      '# Title\n\nSome **bold** text, a [link](https://example.com), `code`.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nline one<br>line two\n\n<details><summary>More</summary>\n\nhidden text\n\n</details>\n\n![ok](/img/a.png)',
    ];
    expect(render(docs, true)).toEqual(render(docs, false));
  });

  it('keeps an image alt and a link title that start with "JavaScript:"', () => {
    const [html] = render(['![JavaScript: tips](x.png) and [l](x.md "JavaScript: tips")'], true);
    expect(html).toContain('alt="JavaScript: tips"');
    expect(html).toContain('title="JavaScript: tips"');
  });
});
