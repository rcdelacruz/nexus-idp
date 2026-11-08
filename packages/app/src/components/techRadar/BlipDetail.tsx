import React, { useEffect, useRef } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { useColors } from '@stratpoint/theme-utils';
import { Blip, movementLabel, quadrantName, ringDef } from './radarModel';
import { ringColor } from './radarColors';
import { DescriptionHtml } from './descriptionHtml';

interface Props {
  blip: Blip;
  byId: Map<string, Blip>;
  onClose: () => void;
  onSelect: (id: string) => void;
}

const pill = (color: string, border: string): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  border: `1px solid ${border}`,
  borderRadius: 100,
  padding: '3px 10px',
  fontSize: '0.75rem',
  color,
});

/** The open technology. Esc closes it, and focus goes back to where it was opened from. */
export const BlipDetail = ({ blip, byId, onClose, onSelect }: Props) => {
  const c = useColors();
  const heading = useRef<HTMLHeadingElement>(null);

  const openedFor = useRef(blip.id);

  useEffect(() => {
    const active = document.activeElement as HTMLElement | null;
    // Safari and Firefox on macOS do not focus a clicked button, so fall back to the dot or row
    // that was clicked.
    const opener =
      active && active !== document.body
        ? active
        : document.querySelector<HTMLElement>(`[data-blip-id="${openedFor.current}"], [data-list-blip-id="${openedFor.current}"]`);
    heading.current?.focus();
    return () => {
      // Not back onto something that is hidden now (e.g. a dot that a new search faded out).
      if (opener && document.contains(opener) && !opener.closest('[aria-hidden="true"]')) opener.focus();
    };
  }, []);

  useEffect(() => {
    heading.current?.focus();
  }, [blip.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // Escape inside the search box, or inside a menu or dialog, belongs to that control.
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, [role="dialog"], [role="menu"], [role="listbox"]')) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const ring = ringDef(blip.ring);
  const related = blip.related.map(id => byId.get(id)).filter((b): b is Blip => !!b);

  return (
    <aside
      aria-label={`Details: ${blip.name}`}
      style={{ background: c.surface, border: `1px solid ${c.border}`, borderRadius: 8, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}
    >
      <style>{`
        .tech-radar-description { font-size: 0.875rem; line-height: 1.65; color: ${c.textSecondary}; }
        .tech-radar-description p, .tech-radar-description .tech-radar-heading { margin: 0 0 12px; }
        .tech-radar-description ul, .tech-radar-description ol { margin: 0 0 12px; padding-left: 20px; }
        .tech-radar-description strong { color: ${c.text}; font-weight: 600; }
        .tech-radar-description code { font-size: 0.8125rem; background: ${c.hoverBg}; border-radius: 4px; padding: 1px 5px; }
        .tech-radar-description a { color: ${c.blue}; text-decoration: none; }
        .tech-radar-description a:hover { text-decoration: underline; }
      `}</style>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <h2 ref={heading} tabIndex={-1} style={{ flex: 1, margin: 0, fontSize: '1.25rem', fontWeight: 600, letterSpacing: '-0.025em', color: c.text, outline: 'none' }}>
          {blip.name}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          style={{ border: `1px solid ${c.border}`, background: 'transparent', color: c.textSecondary, borderRadius: 6, width: 32, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
        >
          <X size={16} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <span style={pill(c.text, c.border)}>{quadrantName(blip.quadrant)}</span>
        <span style={pill(c.text, c.border)}>
          <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: ringColor(blip.ring) }} />
          {ring.name}
        </span>
        {blip.movement !== 'none' && <span style={pill(c.text, c.border)}>{movementLabel[blip.movement]}</span>}
      </div>
      <div style={{ fontSize: '0.8125rem', color: c.textMuted }}>{ring.description}</div>

      <DescriptionHtml html={blip.descriptionHtml} />

      {related.length > 0 && (
        <div>
          <div style={{ fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: c.textMuted, marginBottom: 6 }}>Related</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {related.map(r => (
              <button
                key={r.id}
                type="button"
                onClick={() => onSelect(r.id)}
                style={{ ...pill(c.text, c.border), background: c.surface, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: ringColor(r.ring) }} />
                {r.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <a
        href={blip.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', color: c.blue, textDecoration: 'none' }}
      >
        <ExternalLink size={14} strokeWidth={1.5} aria-hidden="true" /> View on thoughtworks.com
      </a>
    </aside>
  );
};
