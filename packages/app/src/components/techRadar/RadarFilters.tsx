import React from 'react';
import { Search, X } from 'lucide-react';
import { useColors } from '@stratpoint/theme-utils';
import { Blip, Lens, NO_FILTERS, QUADRANTS, RadarFilters as Filters, RingDef, countBy, isFiltered } from './radarModel';
import { ringColor } from './radarColors';

interface Props {
  filters: Filters;
  blips: Blip[];
  rings: RingDef[];
  shown: number;
  onChange: (next: Filters) => void;
  searchRef?: React.Ref<HTMLInputElement>;
}

const sectionLabel: React.CSSProperties = {
  fontSize: '0.6875rem',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  minWidth: 72,
};

export const RadarFilters = ({ filters, blips, rings, shown, onChange, searchRef }: Props) => {
  const c = useColors();
  const byQuadrant = countBy(blips, b => b.quadrant);
  const byRing = countBy(blips, b => b.ring);
  const newCount = blips.filter(b => b.movement === 'new').length;
  const movedCount = blips.filter(b => b.movement === 'moved-in' || b.movement === 'moved-out').length;

  const toggle = <T extends string>(list: T[], value: T): T[] => (list.includes(value) ? list.filter(v => v !== value) : [...list, value]);

  const chip = (selected: boolean, label: React.ReactNode, count: number, onClick: () => void, key: string) => (
    <button
      key={key}
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 32,
        padding: '0 12px',
        borderRadius: 6,
        border: `1px solid ${selected ? c.text : c.border}`,
        background: selected ? c.hoverBg : c.surface,
        color: c.text,
        fontSize: '0.8125rem',
        fontWeight: 500,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {label}
      <span style={{ color: c.textMuted, fontWeight: 400 }}>{count}</span>
    </button>
  );

  const lens = (value: Lens, label: string, count: number) => chip(filters.lens === value, label, count, () => onChange({ ...filters, lens: value }), `lens-${value}`);

  const row = (label: string, children: React.ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ ...sectionLabel, color: c.textMuted }}>{label}</span>
      {children}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            height: 40,
            padding: '0 12px',
            borderRadius: 6,
            border: `1px solid ${c.border}`,
            background: c.inputBg,
            flex: '1 1 280px',
            maxWidth: 460,
          }}
        >
          <Search size={16} strokeWidth={1.5} color={c.textMuted} aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            value={filters.q}
            onChange={e => onChange({ ...filters, q: e.target.value })}
            placeholder="Search technologies and descriptions"
            aria-label="Search technologies"
            style={{ flex: 1, border: 0, outline: 0, background: 'transparent', color: c.text, fontSize: '0.875rem', fontFamily: 'inherit', minWidth: 0 }}
          />
          <kbd style={{ fontSize: '0.6875rem', color: c.textMuted, border: `1px solid ${c.border}`, borderRadius: 4, padding: '1px 6px' }}>/</kbd>
        </label>
        <span role="status" aria-live="polite" style={{ fontSize: '0.8125rem', color: c.textSecondary }}>
          {shown} of {blips.length} technologies
        </span>
        {isFiltered(filters) && (
          <button
            type="button"
            onClick={() => onChange(NO_FILTERS)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 32, padding: '0 10px', borderRadius: 6, border: `1px solid ${c.border}`, background: 'transparent', color: c.textSecondary, fontSize: '0.8125rem', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            <X size={14} strokeWidth={1.5} aria-hidden="true" /> Clear filters
          </button>
        )}
      </div>

      {row(
        'Quadrant',
        QUADRANTS.map(q => chip(filters.quadrants.includes(q.id), q.name, byQuadrant[q.id] ?? 0, () => onChange({ ...filters, quadrants: toggle(filters.quadrants, q.id) }), q.id)),
      )}
      {row(
        'Ring',
        rings.map(r =>
          chip(
            filters.rings.includes(r.id),
            <>
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: ringColor(r.id), display: 'inline-block' }} />
              {r.name}
            </>,
            byRing[r.id] ?? 0,
            () => onChange({ ...filters, rings: toggle(filters.rings, r.id) }),
            r.id,
          ),
        ),
      )}
      {row('Changes', <>{lens('all', 'All', blips.length)}{lens('new', 'New', newCount)}{lens('moved', 'Moved', movedCount)}</>)}
    </div>
  );
};
