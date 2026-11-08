/**
 * Makes a document safe to compile and run.
 *
 * Docs are fetched from GitHub repos and compiled with MDX, and the compiled function was then RUN in the backend process:
 * `{process.env.X}` in a doc printed the backend's environment (DB password, GitHub token, AWS keys, BACKEND_SECRET) into the
 * page. The rendered HTML is also put into the page with innerHTML, so a `<script>`, an `<iframe src="javascript:...">` or a
 * `javascript:` link in a doc would run in the portal's origin for everyone who opens it. Anyone who can merge to one of the docs
 * repos could do either (audit 2026-11-07).
 *
 * A doc is text plus the known components (Callout, Tabs, Cards...), so this plugin removes everything else that can execute:
 *  - ESM (`import`/`export`) and every `{expression}` that is not plain data: `{" "}` and `items={['npm', 'pnpm']}` (strings, numbers,
 *    booleans, arrays and objects of those) are kept because real docs use them, anything with a name, a call or a member access is
 *    removed, and so is every `{...spread}` attribute;
 *  - elements that load or run code: script, iframe, object, embed, form, style, link, meta, base...;
 *  - `on*` event attributes and `srcDoc`;
 *  - links, images and URL attributes that use the javascript:, vbscript: or data: schemes.
 * It is a remark plugin: it runs on the markdown tree before MDX turns it into a function, so nothing unsafe is ever compiled.
 */

const EXPRESSION_NODES = new Set(['mdxFlowExpression', 'mdxTextExpression']);
const JSX_NODES = new Set(['mdxJsxFlowElement', 'mdxJsxTextElement']);

const FORBIDDEN_ELEMENTS = new Set([
  'script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'base', 'meta', 'link', 'form', 'style', 'noscript',
  'template', 'portal', 'fencedframe', 'math', 'foreignobject',
  // SVG animation can rewrite an href to a javascript: URL after the page was checked.
  'animate', 'animatemotion', 'animatetransform', 'set', 'discard', 'mpath',
]);

// Attributes whose value is a URL (and the SVG animation ones that set one); any other attribute only gets the script-scheme check.
const URL_ATTRIBUTES = new Set([
  'href', 'src', 'action', 'formaction', 'data', 'poster', 'srcset', 'background', 'ping', 'cite', 'manifest', 'codebase', 'xlinkhref', 'values', 'to', 'from', 'by',
]);

// Attributes that hold text for people, never a URL: a value like "JavaScript: basics" is a label, not a script. (Every other attribute
// that is not a known URL attribute still gets the script-scheme check, for components that pass a prop on to an href.)
const TEXT_ATTRIBUTES = new Set([
  'alt', 'title', 'label', 'placeholder', 'items', 'summary', 'description', 'caption', 'heading', 'name', 'id', 'class', 'classname', 'lang', 'dir', 'role', 'type', 'value',
]);
function isTextAttribute(name: string): boolean {
  const lower = name.toLowerCase();
  return TEXT_ATTRIBUTES.has(lower) || lower.startsWith('aria-') || lower.startsWith('data-');
}

/** True for an estree that is only data: a literal, a template literal without holes, or an array/object of those (and -1). */
function isLiteralOnly(node: any): boolean {
  switch (node?.type) {
    case 'Program':
      return node.body.length === 0 || (node.body.length === 1 && node.body[0].type === 'ExpressionStatement' && isLiteralOnly(node.body[0].expression));
    case 'Literal':
      return !node.regex;
    case 'TemplateLiteral':
      return node.expressions.length === 0;
    case 'UnaryExpression':
      return (node.operator === '-' || node.operator === '+') && node.argument?.type === 'Literal' && typeof node.argument.value === 'number';
    case 'ArrayExpression':
      return node.elements.every((e: any) => e && e.type !== 'SpreadElement' && isLiteralOnly(e));
    case 'ObjectExpression':
      return node.properties.every(
        (p: any) => p.type === 'Property' && !p.computed && !p.method && p.kind === 'init' && (p.key.type === 'Identifier' || p.key.type === 'Literal') && isLiteralOnly(p.value),
      );
    default:
      return false;
  }
}

/** Every string inside a literal-only estree (so `href={'javascript:x'}` is judged like `href="javascript:x"`). */
function stringsIn(node: any, out: string[] = []): string[] {
  if (!node || typeof node !== 'object') return out;
  if (node.type === 'Literal' && typeof node.value === 'string') out.push(node.value);
  if (node.type === 'TemplateLiteral') for (const q of node.quasis) out.push(q.value?.cooked ?? '');
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range' || key === 'start' || key === 'end') continue;
    const v = (node as any)[key];
    if (Array.isArray(v)) v.forEach(c => stringsIn(c, out));
    else if (v && typeof v === 'object') stringsIn(v, out);
  }
  return out;
}

/** An expression node that is only data is harmless: it runs nothing. */
function isHarmlessExpression(node: any): boolean {
  return isLiteralOnly(node?.data?.estree);
}

/** Controls and whitespace are ignored by browsers inside a scheme ("java\tscript:"), so ignore them when checking. */
function schemeOf(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\u0000-\u0020\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, '').toLowerCase();
  const m = cleaned.match(/^([a-z][a-z0-9+.-]*):/);
  return m ? m[1] : '';
}

/** False for a scheme that can run code in the page. Relative links, http(s), mailto, tel and #anchors are fine. */
export function isSafeUrl(raw: string, attribute = 'href'): boolean {
  const scheme = schemeOf(raw);
  if (!scheme) return true;
  if (scheme === 'javascript' || scheme === 'vbscript') return false;
  if (scheme === 'data') {
    // Only small inline raster images in `src`; never an HTML/SVG/JS document.
    return attribute === 'src' && /^data:image\/(png|gif|jpe?g|webp);base64,/i.test(raw.replace(/\s+/g, ''));
  }
  return true;
}

/** The URLs inside one attribute value: srcset holds several comma-separated ones, SVG `values` a ;-separated list. */
function candidatesOf(attribute: string, value: string): string[] {
  if (attribute === 'srcset') return value.split(',').map(c => c.trim().split(/\s+/)[0]);
  if (attribute === 'values') return value.split(';');
  return [value];
}

// ── style ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// A document must not be able to restyle the portal around it (a full-page overlay that imitates a login box, say). Layout that
// takes an element out of flow or moves it, and anything that loads a resource or runs an expression, is dropped; ordinary text
// and spacing styles stay. Keep in step with plugins/engineering-docs/src/components/EngineeringDocsPage/safeHtml.ts and
// plugins/engineering-docs-backend/src/service/mdxSafety.ts.
const BLOCKED_STYLE_PROPERTIES = new Set(
  [
  'position', 'z-index', 'inset', 'inset-block', 'inset-inline', 'top', 'right', 'bottom', 'left', 'transform', 'translate', 'rotate', 'scale',
  'perspective', 'pointer-events', 'content', 'behavior', '-moz-binding', 'clip', 'clip-path', 'mask', 'mask-image', 'float', 'contain',
  'container', 'anchor-name', 'position-anchor', 'view-transition-name', 'top-layer', 'overlay',
].map(p => p.replace(/-/g, '')),
);

/** Whether one CSS declaration is fine to keep. `property` is kebab-case or camelCase. */
export function isSafeStyleDeclaration(property: string, value: string): boolean {
  const trimmed = property.trim();
  // CSS escapes work inside property names (p\6f sition is position): a name that is not plain letters, digits and hyphens is dropped.
  if (!/^-{0,2}[A-Za-z_][A-Za-z0-9_-]*$/.test(trimmed)) return false;
  // z-index, zIndex and Z-INDEX are the same property: compare without hyphens, lower-cased.
  const name = trimmed.toLowerCase().replace(/-/g, '');
  if (BLOCKED_STYLE_PROPERTIES.has(name)) return false;
  const v = value.toLowerCase();
  if (/url\s*\(|expression\s*\(|javascript:|vbscript:|@import|image-set\s*\(|\\/.test(v)) return false;
  // A negative margin can drag an element over its neighbours as well as position can.
  if (name.startsWith('margin') && /(^|[\s:(])-\s*\d/.test(v)) return false;
  return true;
}

/** `a: b; c: d` with the unsafe declarations removed. */
export function safeStyleText(css: string): string {
  return css
    .split(';')
    .map(d => d.trim())
    .filter(d => {
      const i = d.indexOf(':');
      return d !== '' && i > 0 && isSafeStyleDeclaration(d.slice(0, i), d.slice(i + 1));
    })
    .join('; ');
}

/** The text of a literal or hole-free template literal node ('' for anything else). */
function literalText(node: any): string {
  if (node.type === 'Literal') return String(node.value);
  if (node.type === 'TemplateLiteral') return node.quasis.map((q: any) => q.value?.cooked ?? '').join('');
  return '';
}

/** style={{...}} (the only form React accepts): drop the unsafe properties from the object; the attribute goes when none is left. */
function cleanStyleAttribute(attr: any): boolean {
  if (typeof attr.value === 'string') {
    attr.value = safeStyleText(attr.value);
    return attr.value !== '';
  }
  const expression = attr.value?.data?.estree?.body?.[0]?.expression;
  if (!isHarmlessExpression(attr.value) || expression?.type !== 'ObjectExpression') return false;
  expression.properties = expression.properties.filter((p: any) => {
    const key = p.key.type === 'Identifier' ? p.key.name : String(p.key.value);
    return isSafeStyleDeclaration(key, literalText(p.value));
  });
  return expression.properties.length > 0;
}

/** Whether any of these attribute values would put a script scheme in the page. */
function unsafeValue(name: string, values: string[]): boolean {
  const lower = name.toLowerCase();
  const base = lower.includes(':') ? lower.split(':').pop()! : lower;
  const isUrl = URL_ATTRIBUTES.has(base) || URL_ATTRIBUTES.has(lower);
  // srcset holds several URLs, SVG `values` a ;-separated list: judge each candidate.
  const candidates = values.flatMap(v => candidatesOf(base, v));
  if (!isUrl && isTextAttribute(lower)) return false;
  return candidates.some(c => (isUrl ? !isSafeUrl(c, base) : ['javascript', 'vbscript'].includes(schemeOf(c))));
}

function cleanAttributes(attributes: any[]): any[] {
  return attributes.filter(attr => {
    if (attr.type !== 'mdxJsxAttribute') return false; // {...spread} and any other expression attribute
    const name = String(attr.name).toLowerCase();
    if (name.startsWith('on') || name === 'srcdoc' || name === 'dangerouslysetinnerhtml') return false;
    if (name === 'style') return cleanStyleAttribute(attr);
    if (attr.value === null || attr.value === undefined) return true;
    if (typeof attr.value === 'string') return !unsafeValue(attr.name, [attr.value]);
    // name={expression}: only plain data is kept, and its strings are judged like a string attribute.
    if (!isHarmlessExpression(attr.value)) return false;
    return !unsafeValue(attr.name, stringsIn(attr.value.data.estree));
  });
}

function clean(node: any): void {
  if (!Array.isArray(node.children)) return;
  node.children = node.children.filter((child: any) => {
    if (child.type === 'mdxjsEsm') return false;
    if (EXPRESSION_NODES.has(child.type)) return isHarmlessExpression(child);
    if (JSX_NODES.has(child.type) && typeof child.name === 'string' && FORBIDDEN_ELEMENTS.has(child.name.toLowerCase())) return false;
    return true;
  });
  for (const child of node.children) {
    if (JSX_NODES.has(child.type)) child.attributes = cleanAttributes(child.attributes ?? []);
    if ((child.type === 'link' || child.type === 'image' || child.type === 'definition') && typeof child.url === 'string') {
      if (!isSafeUrl(child.url, child.type === 'image' ? 'src' : 'href')) child.url = '#';
    }
    clean(child);
  }
}

/** remark plugin: see the file comment. */
export function remarkNoExecution() {
  return (tree: any) => {
    clean(tree);
    return tree;
  };
}
