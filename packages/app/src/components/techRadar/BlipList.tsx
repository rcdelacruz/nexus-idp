import React from 'react';
import { useColors } from '@stratpoint/theme-utils';
import { Blip, QUADRANTS, RingDef, blipLabel, ringDef } from './radarModel';
import { ringColor } from './radarColors';

const MOVEMENT_TAG = { new: 'New', 'moved-in': '▲ Moved in', 'moved-out': '▼ Moved out', none: '' };

interface Props {
  blips: Blip[];
  rings: RingDef[];
  selectedId?: string;
  hoverId?: string;
  onSelect: (id: string) => void;
  onHover: (id?: string) => void;
  maxHeight?: number;
}

/**
 * Every visible technology, grouped quadrant → ring. It is the primary view on small screens and
 * the keyboard / screen-reader route through the radar.
 */
export const BlipList = ({ blips, rings, selectedId, hoverId, onSelect, onHover, maxHeight }: Props) => {
  const c = useColors();
  if (!blips.length) {
    return (
      <div style={{ padding: 24, border: `1px dashed ${c.border}`, borderRadius: 8, color: c.textSecondary, fontSize: '0.875rem' }}>
        No technologies match these filters.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxHeight, overflowY: maxHeight ? 'auto' : undefined, paddingRight: maxHeight ? 4 : 0 }}>
      {QUADRANTS.map(q => {
        const inQuadrant = blips.filter(b => b.quadrant === q.id);
        if (!inQuadrant.length) return null;
        return (
          <section key={q.id} aria-label={q.name}>
            <h3 style={{ margin: '0 0 8px', fontSize: '0.875rem', fontWeight: 600, letterSpacing: '-0.006em', color: c.text }}>
              {q.name} <span style={{ color: c.textMuted, fontWeight: 400 }}>{inQuadrant.length}</span>
            </h3>
            {rings.map(r => {
              const inRing = inQuadrant.filter(b => b.ring === r.id);
              if (!inRing.length) return null;
              return (
                <div key={r.id} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '0 0 4px', fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: c.textMuted }}>
                    <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: ringColor(r.id) }} />
                    {ringDef(r.id).name}
                  </div>
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {inRing.map(b => {
                      const selected = b.id === selectedId;
                      return (
                        <li key={b.id}>
                          <button
                            type="button"
                            data-list-blip-id={b.id}
                            aria-label={blipLabel(b)}
                            aria-pressed={selected}
                            onClick={() => onSelect(b.id)}
                            onMouseEnter={() => onHover(b.id)}
                            onMouseLeave={() => onHover(undefined)}
                            onFocus={() => onHover(b.id)}
                            onBlur={() => onHover(undefined)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10,
                              width: '100%',
                              textAlign: 'left',
                              padding: '6px 8px',
                              borderRadius: 6,
                              border: `1px solid ${selected ? c.text : 'transparent'}`,
                              background: selected || hoverId === b.id ? c.hoverBg : 'transparent',
                              color: c.text,
                              fontSize: '0.875rem',
                              cursor: 'pointer',
                              fontFamily: 'inherit',
                            }}
                          >
                            <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 5, background: ringColor(b.ring), flex: '0 0 auto' }} />
                            <span style={{ flex: 1, minWidth: 0 }}>{b.name}</span>
                            {b.movement !== 'none' && (
                              <span style={{ fontSize: '0.6875rem', fontWeight: 500, color: c.textSecondary, border: `1px solid ${c.border}`, borderRadius: 100, padding: '1px 8px', whiteSpace: 'nowrap' }}>
                                {MOVEMENT_TAG[b.movement]}
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
};
