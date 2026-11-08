/* eslint-disable no-script-url -- the point of these tests is documents that contain script URLs */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
// eslint-disable-next-line @backstage/no-undeclared-imports -- test-only: the root devDependency transpiles the plugin for the child process
import ts from 'typescript';
import { isSafeStyleDeclaration, isSafeUrl, remarkNoExecution, safeStyleText } from './mdxSafety';

jest.setTimeout(120_000);

// ── Unit tests on hand-built markdown trees ──────────────────────────────────────────────────────────────────────────────────

const jsx = (name: string, attributes: any[] = [], children: any[] = []) => ({ type: 'mdxJsxFlowElement', name, attributes, children });
const attr = (name: string, value: any) => ({ type: 'mdxJsxAttribute', name, value });
const run = (children: any[]) => {
  const tree: any = { type: 'root', children };
  remarkNoExecution()(tree);
  return tree.children;
};

describe('remarkNoExecution (tree level)', () => {
  it('removes ESM and every expression node, nested ones too', () => {
    const out = run([
      { type: 'mdxjsEsm', value: 'export const a = process.env.X' },
      { type: 'paragraph', children: [{ type: 'text', value: 'hi' }, { type: 'mdxTextExpression', value: 'process.env.X' }] },
      { type: 'mdxFlowExpression', value: 'process.env.X' },
    ]);
    expect(out).toEqual([{ type: 'paragraph', children: [{ type: 'text', value: 'hi' }] }]);
  });

  it('removes attribute expressions and spreads, keeps plain string attributes', () => {
    const [el] = run([
      jsx('Callout', [
        attr('type', 'warning'),
        attr('title', { type: 'mdxJsxAttributeValueExpression', value: 'process.env.X' }),
        { type: 'mdxJsxExpressionAttribute', value: '...process.env' },
        attr('flag', null),
      ]),
    ]);
    expect(el.attributes).toEqual([attr('type', 'warning'), attr('flag', null)]);
  });

  it.each(['script', 'IFRAME', 'object', 'embed', 'form', 'style', 'link', 'meta', 'base', 'template', 'foreignObject'])(
    'removes <%s> with its content',
    tag => {
      expect(run([jsx(tag, [], [{ type: 'text', value: 'x' }]), { type: 'paragraph', children: [] }])).toEqual([{ type: 'paragraph', children: [] }]);
    },
  );

  it('removes on* handlers and srcDoc whatever the case', () => {
    const [el] = run([jsx('img', [attr('src', '/a.png'), attr('onError', 'x'), attr('ONLOAD', 'x'), attr('onclick', 'x'), attr('srcDoc', '<p>')])]);
    expect(el.attributes).toEqual([attr('src', '/a.png')]);
  });

  it.each([
    ['href', 'javascript:alert(1)'],
    ['href', '  JaVa\tScRiPt:alert(1)'],
    ['href', 'java\nscript:alert(1)'],
    ['href', 'vbscript:x'],
    ['href', 'data:text/html;base64,PHNjcmlwdD4='],
    ['src', 'data:image/svg+xml;base64,PHN2Zz4='],
    ['action', 'javascript:x'],
    ['xlink:href', 'javascript:x'],
    ['srcSet', 'a.png 1x, javascript:x 2x'],
  ])('removes %s="%s"', (name, value) => {
    const [el] = run([jsx('a', [attr(name, value), attr('title', 't')])]);
    expect(el.attributes).toEqual([attr('title', 't')]);
  });

  it.each([
    ['href', 'https://example.com/x?a=1'],
    ['href', '/docs/page#anchor'],
    ['href', '#top'],
    ['href', 'mailto:a@b.co'],
    ['href', 'relative/page.md'],
    ['src', 'data:image/png;base64,iVBORw0KGgo='],
    ['href', 'tel:+639171234567'],
  ])('keeps %s="%s"', (name, value) => {
    const [el] = run([jsx('a', [attr(name, value)])]);
    expect(el.attributes).toEqual([attr(name, value)]);
  });

  it('defuses markdown links, images and definitions that use a script scheme', () => {
    const out = run([
      { type: 'paragraph', children: [{ type: 'link', url: 'javascript:alert(1)', children: [] }, { type: 'image', url: 'data:text/html,x', alt: '' }] },
      { type: 'definition', url: 'vbscript:x', identifier: 'a' },
      { type: 'paragraph', children: [{ type: 'link', url: 'https://ok.example', children: [] }] },
    ]);
    expect(out[0].children.map((c: any) => c.url)).toEqual(['#', '#']);
    expect(out[1].url).toBe('#');
    expect(out[2].children[0].url).toBe('https://ok.example');
  });
});

// estree fragments as micromark attaches them to expression nodes (data.estree is a Program holding one expression statement).
const prog = (expression: any) => ({ type: 'Program', body: [{ type: 'ExpressionStatement', expression }] });
const lit = (value: any) => ({ type: 'Literal', value });
const withEstree = (node: any, expression: any) => ({ ...node, data: { estree: prog(expression) } });
const ident = (name: string) => ({ type: 'Identifier', name });

describe('remarkNoExecution (plain-data expressions are kept, real code is not)', () => {
  const attrExpr = (expression: any) => ({ type: 'mdxJsxAttributeValueExpression', value: '...', data: { estree: prog(expression) } });

  it('keeps {" "} and a string/number/array/object in text, as real docs use them', () => {
    const keep = [lit(' '), lit(200), { type: 'ArrayExpression', elements: [lit('npm'), lit('pnpm')] }, { type: 'TemplateLiteral', expressions: [], quasis: [{ value: { cooked: 'x' } }] },
      { type: 'ObjectExpression', properties: [{ type: 'Property', kind: 'init', computed: false, method: false, key: ident('a'), value: lit(1) }] }, { type: 'UnaryExpression', operator: '-', argument: lit(1) }];
    for (const e of keep) {
      const out = run([{ type: 'paragraph', children: [withEstree({ type: 'mdxTextExpression', value: 'x' }, e)] }]);
      expect(out[0].children).toHaveLength(1);
    }
  });

  it('keeps items={[...]} on a component (Nextra tabs) and width={200}', () => {
    const [el] = run([jsx('Tabs', [attr('items', attrExpr({ type: 'ArrayExpression', elements: [lit('npm'), lit('pnpm')] })), attr('width', attrExpr(lit(200)))])]);
    expect(el.attributes.map((a: any) => a.name)).toEqual(['items', 'width']);
  });

  it.each([
    ['a name', ident('secret')],
    ['a member access', { type: 'MemberExpression', object: ident('process'), property: ident('env'), computed: false }],
    ['a call', { type: 'CallExpression', callee: ident('f'), arguments: [] }],
    ['a template with a hole', { type: 'TemplateLiteral', expressions: [ident('x')], quasis: [{ value: { cooked: '' } }, { value: { cooked: '' } }] }],
    ['an array holding a name', { type: 'ArrayExpression', elements: [lit(1), ident('x')] }],
    ['an object holding a name', { type: 'ObjectExpression', properties: [{ type: 'Property', kind: 'init', computed: false, method: false, key: ident('a'), value: ident('secret') }] }],
    ['a spread inside an array', { type: 'ArrayExpression', elements: [{ type: 'SpreadElement', argument: lit(1) }] }],
    ['a computed key', { type: 'ObjectExpression', properties: [{ type: 'Property', kind: 'init', computed: true, key: ident('k'), value: lit(1) }] }],
    ['a getter', { type: 'ObjectExpression', properties: [{ type: 'Property', kind: 'get', computed: false, key: ident('k'), value: lit(1) }] }],
    ['a regex', { type: 'Literal', regex: { pattern: 'a', flags: '' }, value: null }],
    ['an operation', { type: 'BinaryExpression', operator: '+', left: lit(1), right: lit(2) }],
  ])('removes %s', (_name, expression) => {
    const out = run([{ type: 'paragraph', children: [withEstree({ type: 'mdxTextExpression', value: 'x' }, expression)] }]);
    expect(out[0].children).toEqual([]);
    const [el] = run([jsx('p', [attr('title', attrExpr(expression))])]);
    expect(el.attributes).toEqual([]);
  });

  it('judges the strings inside a kept attribute expression like a plain attribute', () => {
    const [el] = run([jsx('a', [attr('href', attrExpr(lit('javascript:alert(1)'))), attr('title', attrExpr(lit('ok')))])]);
    expect(el.attributes.map((a: any) => a.name)).toEqual(['title']);
  });

  it('keeps text that merely starts like a scheme (a tab label, an alt, a title) and still removes a script URL in any other attribute', () => {
    const [tabs] = run([jsx('Tabs', [attr('items', attrExpr({ type: 'ArrayExpression', elements: [lit('JavaScript: basics'), lit('Python')] }))])]);
    expect(tabs.attributes.map((a: any) => a.name)).toEqual(['items']);
    const [img] = run([jsx('img', [attr('alt', 'JavaScript: tips'), attr('title', 'vbscript: how-to'), attr('aria-label', 'JavaScript: x'), attr('data-note', 'javascript: y'), attr('link', 'javascript:alert(1)'), attr('xlinkHref', 'data:text/html;base64,AAAA')])]);
    expect(img.attributes.map((a: any) => a.name)).toEqual(['alt', 'title', 'aria-label', 'data-note']);
  });

  it('removes SVG animation (it can rewrite an href to javascript: later) and script schemes in any attribute value', () => {
    for (const tag of ['animate', 'animateMotion', 'animateTransform', 'set', 'discard', 'mpath']) {
      expect(run([jsx(tag), { type: 'paragraph', children: [] }])).toEqual([{ type: 'paragraph', children: [] }]);
    }
    const [el] = run([jsx('text', [attr('values', 'a;javascript:alert(1)'), attr('to', 'javascript:x'), attr('link', 'vbscript:x'), attr('alt', 'Data: the results'), attr('id', 'keep')])]);
    expect(el.attributes.map((a: any) => a.name)).toEqual(['alt', 'id']);
  });
});

describe('remarkNoExecution (style)', () => {
  const objectProp = (key: string, value: any) => ({ type: 'Property', kind: 'init', computed: false, method: false, key: ident(key), value });
  const styleAttr = (props: any[]) => attr('style', { type: 'mdxJsxAttributeValueExpression', value: '...', data: { estree: prog({ type: 'ObjectExpression', properties: props }) } });

  it('keeps ordinary style properties and removes the ones that move or cover things', () => {
    const [el] = run([jsx('div', [styleAttr([objectProp('color', lit('red')), objectProp('position', lit('fixed')), objectProp('zIndex', lit(9)), objectProp('textAlign', lit('center')), objectProp('marginLeft', lit('-9999px')), objectProp('background', lit('url(https://x.example/a.png)'))])])]);
    const props = el.attributes[0].value.data.estree.body[0].expression.properties.map((p: any) => p.key.name);
    expect(props).toEqual(['color', 'textAlign']);
  });

  it('removes the attribute when nothing safe is left, and any style that is not a plain object', () => {
    expect(run([jsx('div', [styleAttr([objectProp('position', lit('fixed'))])])])[0].attributes).toEqual([]);
    expect(run([jsx('div', [attr('style', { type: 'mdxJsxAttributeValueExpression', value: 'x', data: { estree: prog(ident('s')) } })])])[0].attributes).toEqual([]);
    expect(run([jsx('div', [attr('style', 'position:fixed')])])[0].attributes).toEqual([]);
    expect(run([jsx('div', [attr('style', 'color:red; position:fixed')])])[0].attributes).toEqual([attr('style', 'color:red')]);
  });

  it('shares the declaration rules with the viewer', () => {
    expect(safeStyleText('color: red; position: fixed')).toBe('color: red');
    expect(isSafeStyleDeclaration('zIndex', '1')).toBe(false);
  });
});

describe('isSafeUrl', () => {
  it.each(['', 'a/b', '//cdn.example.com/x.js', 'HTTPS://X.COM', 'ftp://x', 'git@github.com:a/b']) ('allows %j', u => expect(isSafeUrl(u)).toBe(true));
  it.each(['javascript:1', ' javascript:1', 'JAVASCRIPT:1', 'java\u0000script:1', 'java​script:1', 'vbscript:1', 'data:text/html,1', 'data:application/javascript,1'])('refuses %j', u =>
    expect(isSafeUrl(u)).toBe(false),
  );
});

// ── End to end: the real MDX compile and run, in a child Node process (the MDX packages are ESM-only; jest cannot import them) ──

const pluginDir = path.resolve(__dirname, '../..');
const tmpDir = path.join(pluginDir, '.mdx-e2e-tmp');

function compileAll(docs: string[], guard: boolean): Array<{ html?: string; error?: string }> {
  const out = execFileSync(process.execPath, [path.join(tmpDir, 'runner.mjs'), guard ? 'guard' : 'noguard'], {
    cwd: pluginDir,
    input: JSON.stringify(docs),
    env: { ...process.env, SECRET_FOR_TEST: 'leaked-backend-secret' },
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out.toString());
}

beforeAll(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
  const source = fs.readFileSync(path.join(__dirname, 'mdxSafety.ts'), 'utf8');
  fs.writeFileSync(path.join(tmpDir, 'mdxSafety.mjs'), ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText);
  // Same calls as MdxRenderer.compileMdxToHtml, minus the portal's component map.
  fs.writeFileSync(
    path.join(tmpDir, 'runner.mjs'),
    `import { compile, run } from '@mdx-js/mdx';
import * as runtime from 'react/jsx-runtime';
import React from 'react';
import remarkGfm from 'remark-gfm';
import { remarkNoExecution } from './mdxSafety.mjs';
const { renderToStaticMarkup } = await import('react-dom/server');
const guard = process.argv[2] === 'guard';
// Stand-ins for the portal's known components (MdxRenderer KNOWN_COMPONENTS): render their children.
const Plain = ({ children }) => (children ? React.createElement(React.Fragment, null, children) : null);
const Tabs = ({ items, children }) => React.createElement('div', null, (items || []).map(i => React.createElement('span', { key: i, className: 'tab-label' }, i)), children);
const components = { Callout: Plain, Card: Plain, Cards: Plain, Tabs, Tab: Plain, Steps: Plain, FileTree: Plain, Admonition: Plain, TabItem: Plain };
const chunks = []; for await (const c of process.stdin) chunks.push(c);
const docs = JSON.parse(Buffer.concat(chunks).toString());
const results = [];
for (const doc of docs) {
  try {
    const compiled = await compile(doc, { outputFormat: 'function-body', remarkPlugins: guard ? [remarkGfm, remarkNoExecution] : [remarkGfm] });
    const { default: Content } = await run(compiled, { jsx: runtime.jsx, jsxs: runtime.jsxs, Fragment: runtime.Fragment });
    results.push({ html: renderToStaticMarkup(React.createElement(Content, { components })) });
  } catch (e) { results.push({ error: String(e && e.message || e).split('\\n')[0] }); }
}
process.stdout.write(JSON.stringify(results));
`,
  );
});
afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

const EXECUTES = [
  ['an expression in text', 'before {process.env.SECRET_FOR_TEST} after'],
  ['an expression block', 'before\n\n{process.env.SECRET_FOR_TEST}\n\nafter'],
  ['an expression in an attribute', '<Callout type={process.env.SECRET_FOR_TEST}>after</Callout>\n\nbefore'],
  ['a spread attribute', '<p {...{ title: process.env.SECRET_FOR_TEST }}>after</p>\n\nbefore'],
  ['an export', 'export const a = process.env.SECRET_FOR_TEST\n\nbefore {a} after'],
  ['a computed value', 'before {[1].map(() => Object.keys(process.env).length && process.env.SECRET_FOR_TEST)} after'],
];

describe('the real MDX pipeline (child process)', () => {
  it('the harness really sees the leak when the guard is off (so the checks below are not vacuous)', () => {
    const results = compileAll(EXECUTES.map(([, doc]) => doc), false);
    const leaked = results.filter(r => r.html?.includes('leaked-backend-secret')).length;
    expect(leaked).toBeGreaterThanOrEqual(4);
  });

  it.each(EXECUTES)('with the guard, %s no longer runs and the rest of the page is intact', (_name, doc) => {
    const [r] = compileAll([doc], true);
    expect(r.error).toBeUndefined();
    expect(r.html).not.toContain('leaked-backend-secret');
    expect(r.html).toContain('before');
  });

  it('removes what could run in the browser', () => {
    const docs = [
      'a\n\n<script>alert(1)</script>\n\nb',
      'a\n\n<iframe src="javascript:alert(1)"></iframe>\n\nb',
      'a <object data="x"></object> b',
      'a\n\n<form action="https://evil.example"><input name="p"/></form>\n\nb',
      'a\n\n<style>body</style>\n\nb',
      '[click](javascript:alert(1)) and [again](  JaVa\tScRiPt:alert(1))',
      '![i](data:text/html;base64,PHNjcmlwdD4=)',
      '<a href="javascript:alert(1)">x</a>',
      '<Card href="vbscript:x" title="t"/>',
      '<img src="/a.png" onerror="alert(1)" onClick="x"/>',
      '<svg><a href="#"><animate attributeName="href" values="javascript:alert(1)"/><text>click</text></a></svg>',
      '<svg><a href="#"><set attributeName="href" to="javascript:alert(1)"/><text>click</text></a></svg>',
      '<a href={"javascript:alert(1)"}>x</a>',
    ];
    const results = compileAll(docs, true);
    for (const r of results) {
      expect(r.error).toBeUndefined();
      expect(r.html).not.toMatch(/<script|<iframe|<object|<form|<style|<input|<animate|<set\b|javascript:|vbscript:|data:text|onerror|onclick/i);
    }
    expect(results[0].html).toContain('a');
  });

  it('keeps ordinary documentation: headings, tables, code with braces, links, images, components', () => {
    const doc = [
      '# Title',
      '',
      'Text with a [link](https://example.com/x), a [relative](../other.md#part), an [email](mailto:a@b.co) and `inline {braces}`.',
      '',
      '| a | b |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      '```js',
      'const x = { a: process.env.SECRET_FOR_TEST };',
      '```',
      '',
      '![ok](data:image/png;base64,iVBORw0KGgo=)',
      '',
      '<Callout type="warning">Careful</Callout>',
    ].join('\n');
    const [r] = compileAll([doc], true);
    expect(r.error).toBeUndefined();
    expect(r.html).toContain('<h1>Title</h1>');
    expect(r.html).toContain('<a href="https://example.com/x">link</a>');
    expect(r.html).toContain('href="../other.md#part"');
    expect(r.html).toContain('href="mailto:a@b.co"');
    expect(r.html).toContain('<table>');
    expect(r.html).toContain('process.env.SECRET_FOR_TEST'); // a code block shows its text; nothing evaluates it
    expect(r.html).not.toContain('leaked-backend-secret');
    expect(r.html).toContain('src="data:image/png;base64,iVBORw0KGgo="');
  });

  it('keeps the harmless expressions real docs use (Nextra tab labels, {" "}, sizes) and still drops code', () => {
    const [r] = compileAll(['<Tabs items={[\'npm\', \'pnpm\']}>\n\n<Tab>one</Tab>\n\n</Tabs>\n\nA{" "}B <img src="/a.png" width={200}/> {process.env.SECRET_FOR_TEST}'], true);
    expect(r.error).toBeUndefined();
    expect(r.html).toContain('>npm<');
    expect(r.html).toContain('>pnpm<');
    expect(r.html).toContain('A B');
    expect(r.html).toContain('width="200"');
    const [labels] = compileAll(["<Tabs items={['JavaScript: basics', 'Python']}>\n\n<Tab>one</Tab>\n\n</Tabs>"], true);
    expect(labels.html).toContain('>JavaScript: basics<');
    expect(labels.html).toContain('>Python<');
    expect(r.html).not.toContain('leaked-backend-secret');
  });

  it("produces exactly the same pages as before for every document the portal's own docs folder contains", () => {
    const root = path.resolve(pluginDir, '../../docs/content');
    const files: string[] = [];
    const walk = (d: string) => fs.readdirSync(d, { withFileTypes: true }).forEach(e => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.mdx?$/.test(e.name) && files.push(path.join(d, e.name))));
    walk(root);
    expect(files.length).toBeGreaterThan(5);
    const docs = files.map(f => fs.readFileSync(f, 'utf8'));
    const before = compileAll(docs, false);
    const after = compileAll(docs, true);
    // Not vacuous: most of the real docs must actually compile (an all-errors run would compare equal to itself).
    expect(before.filter(r => r.html !== undefined).length).toBeGreaterThan(files.length / 2);
    const different = files.filter((_f, i) => JSON.stringify(before[i]) !== JSON.stringify(after[i])).map(f => path.relative(root, f));
    expect(different).toEqual([]);
  });
});
