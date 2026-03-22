import React from 'react';
import type { TemplateEntityV1beta3 } from '@backstage/plugin-scaffolder-common';
import { getEntityRelations } from '@backstage/plugin-catalog-react';
import { RELATION_OWNED_BY, parseEntityRef } from '@backstage/catalog-model';
import { ArrowUpRight } from 'lucide-react';

const g = {
  bg:       'var(--ds-background-100)',
  border:   'var(--border)',
  borderHv: 'var(--border-hover)',
  fg1:      'var(--fg-primary)',
  fg2:      'var(--fg-secondary)',
  fg3:      'var(--fg-tertiary)',
  gray100:  'var(--ds-gray-100)',
  gray200:  'var(--ds-gray-200)',
  blue:     'var(--blue)',
  radius:   'var(--radius)',
  radiusMd: 'var(--radius-md)',
};


interface Props {
  template: TemplateEntityV1beta3;
  additionalLinks?: { icon?: React.ComponentType; text: string; url: string }[];
  onSelected?: (template: TemplateEntityV1beta3) => void;
}

export const CustomTemplateCard = ({ template, onSelected }: Props) => {
  const [hov, setHov] = React.useState(false);

  const title = template.metadata.title ?? template.metadata.name;
  const description = template.metadata.description;
  const tags = template.metadata.tags ?? [];
  const type = template.spec.type;

  const TYPE_COLORS: Record<string, { bg: string; border: string; color: string }> = {
    service:       { bg: 'rgba(26,110,255,0.08)',  border: 'rgba(26,110,255,0.25)',  color: '#1a6eff' },
    website:       { bg: 'rgba(121,40,202,0.08)',  border: 'rgba(121,40,202,0.25)',  color: '#7928ca' },
    library:       { bg: 'rgba(0,112,243,0.08)',   border: 'rgba(0,112,243,0.25)',   color: '#0070f3' },
    documentation: { bg: 'rgba(80,227,194,0.08)',  border: 'rgba(80,227,194,0.25)',  color: '#0ea47a' },
    training:      { bg: 'rgba(245,166,35,0.08)',  border: 'rgba(245,166,35,0.25)',  color: '#c47d0e' },
    resource:      { bg: 'rgba(143,143,143,0.08)', border: 'rgba(143,143,143,0.25)', color: '#6b6b6b' },
  };
  const typeStyle = TYPE_COLORS[type?.toLowerCase()] ?? { bg: 'var(--surface)', border: g.border, color: g.fg2 };

  const owners = getEntityRelations(template, RELATION_OWNED_BY);
  const ownerName = owners.length
    ? parseEntityRef(owners[0]).name
    : undefined;

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: g.bg,
        border: `1px solid ${hov ? g.borderHv : g.border}`,
        borderRadius: g.radiusMd,
        overflow: 'hidden',
        transition: 'border-color 0.15s',
        cursor: 'pointer',
        height: '100%',
      }}
      onClick={() => onSelected?.(template)}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onSelected?.(template); }}
    >
      {/* Body */}
      <div style={{ padding: '20px', flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Type badge */}
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          alignSelf: 'flex-start',
          height: 22,
          padding: '0 8px',
          borderRadius: 4,
          background: typeStyle.bg,
          border: `1px solid ${typeStyle.border}`,
          fontSize: '0.75rem',
          fontWeight: 500,
          color: typeStyle.color,
        }}>
          {type}
        </span>

        {/* Title */}
        <div style={{
          fontSize: '0.9375rem',
          fontWeight: 600,
          letterSpacing: '-0.02em',
          color: g.fg1,
          lineHeight: 1.35,
        }}>
          {title}
        </div>

        {/* Description */}
        {description && (
          <div style={{
            fontSize: '0.8125rem',
            color: g.fg3,
            lineHeight: 1.6,
            letterSpacing: '-0.006em',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>
            {description}
          </div>
        )}

        {/* Owner */}
        {ownerName && (
          <div style={{ fontSize: '0.75rem', color: g.fg3, letterSpacing: '-0.006em', marginTop: 'auto', paddingTop: 4 }}>
            <span style={{ color: g.fg3 }}>Owner: </span>
            <span style={{ color: g.fg2, fontWeight: 500 }}>{ownerName}</span>
          </div>
        )}

        {/* Tags */}
        {tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {tags.slice(0, 5).map(tag => (
              <span key={tag} style={{
                display: 'inline-flex',
                alignItems: 'center',
                height: 22,
                padding: '0 8px',
                borderRadius: 4,
                background: 'var(--surface)',
                border: `1px solid ${g.border}`,
                fontSize: '0.75rem',
                fontWeight: 500,
                color: g.fg2,
              }}>
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Footer CTA */}
      <div style={{
        padding: '12px 20px',
        borderTop: `1px solid ${g.border}`,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        fontSize: '0.8125rem',
        fontWeight: 500,
        color: hov ? g.fg1 : g.fg2,
        transition: 'color 0.15s',
      }}>
        Choose
        <ArrowUpRight
          size={13}
          strokeWidth={2}
          style={{ transform: hov ? 'translate(1px,-1px)' : 'none', transition: 'transform 0.15s' }}
        />
      </div>
    </div>
  );
};
