/**
 * Renders a radar description. The source is third-party HTML, so it is never injected: it is
 * parsed and rebuilt as React elements through an allowlist. Unknown elements keep their text,
 * script/style disappear completely, and a link survives only if it is a plain https URL.
 */
import React from 'react';
import { unescapeSourceHtml } from './radarModel';

const ALLOWED = new Set(['p', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'code', 'br']);
const DROPPED = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript']);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

function safeHttpsUrl(href: string | null): string | undefined {
  if (!href) return undefined;
  try {
    const url = new URL(href);
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function convert(node: Node, key: string): React.ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (DROPPED.has(tag)) return null;

  const children = Array.from(el.childNodes).map((c, i) => convert(c, `${key}.${i}`));

  if (ALLOWED.has(tag)) return tag === 'br' ? <br key={key} /> : React.createElement(tag, { key }, children);
  if (HEADINGS.has(tag)) {
    return (
      <div key={key} className="tech-radar-heading">
        <strong>{children}</strong>
      </div>
    );
  }
  if (tag === 'a') {
    const href = safeHttpsUrl(el.getAttribute('href'));
    return href ? (
      <a key={key} href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <React.Fragment key={key}>{children}</React.Fragment>
    );
  }
  return <React.Fragment key={key}>{children}</React.Fragment>;
}

export const DescriptionHtml = ({ html }: { html: string }) => {
  const content = React.useMemo(() => {
    const cleaned = unescapeSourceHtml(html);
    if (!cleaned) return null;
    const doc = new DOMParser().parseFromString(cleaned, 'text/html');
    return Array.from(doc.body.childNodes).map((n, i) => convert(n, String(i)));
  }, [html]);
  return <div className="tech-radar-description">{content}</div>;
};
