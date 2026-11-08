/**
 * rehype plugin for the docs viewer's fallback renderer (react-markdown + rehype-raw), which shows a document when the backend's
 * MDX compile fails. A document with one stray `{` makes that compile fail, so the fallback is reachable by anyone who can merge a
 * doc, and rehype-raw lets raw HTML through: `<iframe srcdoc="<script>...">`, `<svg><animate ...javascript:...>`, `<form>`, `<meta
 * http-equiv=refresh>`. The rendered HTML is part of the portal's page, so none of that may survive (audit 2026-11-07).
 *
 * Run it AFTER rehype-raw. It removes elements that load or run code, `on*` handlers and `srcdoc`, and every attribute value that
 * uses a script scheme. Keep in step with plugins/engineering-docs-backend/src/service/mdxSafety.ts (the same rules for the
 * backend's MDX path).
 */

const FORBIDDEN_ELEMENTS = new Set([
  'script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'base', 'meta', 'link', 'form', 'style', 'noscript',
  'template', 'portal', 'fencedframe', 'math', 'foreignobject',
  // SVG animation can rewrite an href to a javascript: URL after the page was checked.
  'animate', 'animatemotion', 'animatetransform', 'set', 'discard', 'mpath',
]);

function schemeOf(raw: string): string {
  // Controls and whitespace are ignored by browsers inside a scheme ("java\tscript:"); so are zero-width characters.
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
    return attribute === 'src' && /^data:image\/(png|gif|jpe?g|webp);base64,/i.test(raw.replace(/\s+/g, ''));
  }
  return true;
}

// Attributes whose value is a URL (and the SVG animation ones that set one); any other attribute only gets the script-scheme check.
const URL_ATTRIBUTES = new Set([
  'href', 'src', 'action', 'formaction', 'data', 'poster', 'srcset', 'background', 'ping', 'cite', 'manifest', 'codebase',
  'xlinkhref', 'values', 'to', 'from', 'by',
]);

/** The URLs inside one attribute value: srcset holds several comma-separated ones, SVG `values` a ;-separated list. */
function candidatesOf(attribute: string, value: string): string[] {
  if (attribute === 'srcset') return value.split(',').map(c => c.trim().split(/\s+/)[0]);
  if (attribute === 'values') return value.split(';');
  return [value];
}

// Attributes that hold text for people, never a URL ("JavaScript: basics" is a label, not a script). hast property names are camelCase
// (ariaLabel, dataFoo). Every other attribute that is not a known URL attribute still gets the script-scheme check.
const TEXT_ATTRIBUTES = new Set([
  'alt', 'title', 'label', 'placeholder', 'items', 'summary', 'description', 'caption', 'heading', 'name', 'id', 'class', 'classname', 'lang', 'dir', 'role', 'type', 'value',
]);
function isTextAttribute(lower: string): boolean {
  return TEXT_ATTRIBUTES.has(lower) || lower.startsWith('aria') || (lower.startsWith('data') && lower !== 'data');
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

/** The string values of a hast property (a string, or an array that may hold strings). */
function stringsOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return typeof value === 'string' ? [value] : [];
}

function cleanProperties(properties: Record<string, unknown>): void {
  for (const key of Object.keys(properties)) {
    const lower = key.toLowerCase();
    if (lower.startsWith('on') || lower === 'srcdoc') {
      delete properties[key];
      continue;
    }
    if (lower === 'style' && typeof properties[key] === 'string') {
      const kept = safeStyleText(properties[key] as string);
      if (kept) properties[key] = kept;
      else delete properties[key];
      continue;
    }
    const value = properties[key];
    const strings = stringsOf(value);
    const isUrl = URL_ATTRIBUTES.has(lower.replace(':', ''));
    // srcset holds several URLs, SVG `values` a ;-separated list: judge each candidate.
    const candidates = strings.flatMap(s => candidatesOf(lower, s));
    const attribute = lower.endsWith('src') ? 'src' : 'href';
    if (!isUrl && isTextAttribute(lower)) continue;
    const unsafe = candidates.some(c => (isUrl ? !isSafeUrl(c, attribute) : ['javascript', 'vbscript'].includes(schemeOf(c))));
    if (unsafe) delete properties[key];
  }
}

function clean(node: any): void {
  if (!Array.isArray(node.children)) return;
  node.children = node.children.filter((child: any) => !(child.type === 'element' && FORBIDDEN_ELEMENTS.has(String(child.tagName).toLowerCase())));
  for (const child of node.children) {
    if (child.type === 'element' && child.properties) cleanProperties(child.properties);
    clean(child);
  }
}

/** rehype plugin: see the file comment. */
export function rehypeSafeHtml() {
  return (tree: any) => {
    clean(tree);
    return tree;
  };
}
