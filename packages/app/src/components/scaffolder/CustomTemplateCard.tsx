import React from 'react';
import type { TemplateEntityV1beta3 } from '@backstage/plugin-scaffolder-common';
import { getEntityRelations } from '@backstage/plugin-catalog-react';
import { RELATION_OWNED_BY, parseEntityRef } from '@backstage/catalog-model';
import { ArrowUpRight } from 'lucide-react';
import { badge } from '@stratpoint/theme-utils';

const g = {
  bg:       'var(--ds-background-100)',
  border:   'var(--border)',
  borderHv: 'var(--border-hover)',
  fg1:      'var(--fg-primary)',
  fg2:      'var(--fg-secondary)',
  fg3:      'var(--fg-tertiary)',
  gray100:  'var(--ds-gray-100)',
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

  // Type badge — subtle variant (category label, not a status)
  const TYPE_BADGE: Record<string, React.CSSProperties> = {
    application:    badge('green-subtle'),
    service:        badge('blue-subtle'),
    website:        badge('purple-subtle'),
    library:        badge('blue-subtle'),
    documentation:  badge('teal-subtle'),
    training:       badge('amber-subtle'),
    resource:       badge('gray-subtle'),
  };
  const typeChip = TYPE_BADGE[type?.toLowerCase()] ?? badge('gray-subtle');

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
        <span style={{ ...typeChip, alignSelf: 'flex-start' }}>
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
              <span key={tag} style={badge('gray-subtle')}>
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
