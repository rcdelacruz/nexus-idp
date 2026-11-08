import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, List, Radar as RadarIcon } from 'lucide-react';
import { useColors } from '@stratpoint/theme-utils';
import { Radar, QuadrantId, filterBlips } from './radarModel';
import { CENTER, placeLabelled } from './radarLayout';
import { RadarChart } from './RadarChart';
import { RadarFilters } from './RadarFilters';
import { BlipList } from './BlipList';
import { BlipDetail } from './BlipDetail';
import { RadarUrlState } from './useRadarUrlState';
import { ringColor } from './radarColors';

/** True when the viewport is at least `minWidth` px wide (the radar needs room; below that the list leads). */
export function useIsWide(minWidth = 1280): boolean {
  const query = `(min-width:${minWidth}px)`;
  const get = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  const [wide, setWide] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const m = window.matchMedia(query);
    const onChange = () => setWide(m.matches);
    onChange();
    m.addEventListener?.('change', onChange);
    return () => m.removeEventListener?.('change', onChange);
  }, [query]);
  return wide;
}

interface Props {
  radar: Radar;
  stale?: boolean;
  state: RadarUrlState;
  wide: boolean;
  onChange: (patch: Partial<RadarUrlState>, options?: { push?: boolean }) => void;
}

const HowToRead = ({ radar }: { radar: Radar }) => {
  const c = useColors();
  const [open, setOpen] = useState(false);
  return (
    <div style={{ border: `1px solid ${c.border}`, borderRadius: 8, background: c.surface }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '12px 16px', background: 'transparent', border: 0, color: c.text, fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
      >
        {open ? <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" /> : <ChevronRight size={16} strokeWidth={1.5} aria-hidden="true" />}
        How to read the radar
        <span style={{ fontWeight: 400, color: c.textMuted }}>· what it is, the rings and the markers</span>
      </button>
      {open && (
        <div style={{ padding: '0 16px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20, fontSize: '0.8125rem', color: c.textSecondary, lineHeight: 1.6 }}>
          <div>
            <div style={{ color: c.text, fontWeight: 600, marginBottom: 4 }}>What this is</div>
            The Thoughtworks Technology Radar: a view of tools, techniques, platforms, and languages and frameworks across the industry, updated about twice a year. It is a general reference, not a list of what any one company uses.
          </div>
          <div>
            <div style={{ color: c.text, fontWeight: 600, marginBottom: 4 }}>Rings (centre to edge)</div>
            {radar.rings.map(r => (
              <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: ringColor(r.id), flex: '0 0 auto' }} />
                <span><strong style={{ color: c.text }}>{r.name}.</strong> {r.description}</span>
              </div>
            ))}
          </div>
          <div>
            <div style={{ color: c.text, fontWeight: 600, marginBottom: 4 }}>Reading the dots</div>
            <div>Each dot is one technology, with its name beside it. Its colour is its ring, and its distance from the centre shows how ready it is.</div>
            <div style={{ marginTop: 6 }}>Click a quadrant title to magnify that quadrant. <strong style={{ color: c.text }}>▲ Moved in</strong> and <strong style={{ color: c.text }}>▼ Moved out</strong> show how a ring changed since the last volume; <strong style={{ color: c.text }}>New</strong> appears in the list and details. Click a dot or a row for the full description. Press <kbd>/</kbd> to search.</div>
          </div>
        </div>
      )}
    </div>
  );
};

export const TechRadarView = ({ radar, stale, state, wide, onChange }: Props) => {
  const c = useColors();
  const searchRef = useRef<HTMLInputElement>(null);
  const [hoverId, setHoverId] = useState<string | undefined>();

  const labelled = useMemo(() => placeLabelled(radar.blips), [radar.blips]);
  const byId = useMemo(() => new Map(radar.blips.map(b => [b.id, b])), [radar.blips]);
  const visible = useMemo(() => filterBlips(radar.blips, state.filters), [radar.blips, state.filters]);
  const visibleIds = useMemo(() => new Set(visible.map(b => b.id)), [visible]);
  const selected = state.blip ? byId.get(state.blip) : undefined;
  const view = state.view ?? (wide ? 'radar' : 'list');
  const zoom: QuadrantId | undefined = state.filters.quadrants.length === 1 ? state.filters.quadrants[0] : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Opening a technology adds one history step (Back closes it); jumping to a related one, or to
  // another dot, replaces it, so a single Back always returns to the radar.
  const select = (id: string) => onChange({ blip: id }, { push: !state.blip });
  const close = () => onChange({ blip: undefined });
  const detail = selected ? <BlipDetail blip={selected} byId={byId} onClose={close} onSelect={select} /> : null;

  const list = (maxHeight?: number) => (
    <BlipList blips={visible} rings={radar.rings} selectedId={state.blip} hoverId={hoverId} onSelect={select} onHover={setHoverId} maxHeight={maxHeight} />
  );
  const chart = (
    <div style={{ background: c.surface, border: `1px solid ${c.border}`, borderRadius: 8, padding: 12 }}>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', fontSize: '0.8125rem', color: c.textSecondary, marginBottom: 8 }}>
        {radar.rings.map(r => (
          <span key={r.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 5, background: ringColor(r.id) }} />
            {r.name}
          </span>
        ))}
        <span style={{ color: c.textMuted }}>{zoom ? 'Click a dot or a name for details.' : 'Click a dot or a name for details · click a quadrant title to magnify it'}</span>
      </div>
      <RadarChart
        blips={radar.blips}
        labelled={labelled}
        visibleIds={visibleIds}
        rings={radar.rings}
        selectedId={state.blip}
        hoverId={hoverId}
        zoom={zoom}
        onSelect={select}
        onHover={setHoverId}
        onZoom={q => onChange({ filters: { ...state.filters, quadrants: q ? [q] : [] } })}
      />
    </div>
  );

  const toggle = (value: 'radar' | 'list', label: string, icon: React.ReactNode) => (
    <button
      key={value}
      type="button"
      aria-pressed={view === value}
      onClick={() => onChange({ view: value })}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px', border: `1px solid ${view === value ? c.text : c.border}`, background: view === value ? c.hoverBg : c.surface, color: c.text, fontSize: '0.8125rem', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', borderRadius: value === 'radar' ? '6px 0 0 6px' : '0 6px 6px 0' }}
    >
      {icon}
      {label}
    </button>
  );

  let body: React.ReactNode;
  if (wide && view === 'radar') {
    // Every name is on the radar, so it takes the full width. The open technology floats over the
    // half of the radar AWAY from its dot, so the dot you clicked is never hidden by its own panel.
    const dock = selected && (labelled.get(selected.id)?.x ?? 0) >= CENTER ? 'left' : 'right';
    body = (
      <div>
        {detail && (
          <div style={{ position: 'sticky', top: 96, height: 0, zIndex: 30 }}>
            <div style={{ position: 'absolute', top: 0, [dock]: 0, width: 420, maxWidth: '100%', maxHeight: 'calc(100vh - 120px)', overflowY: 'auto', borderRadius: 8 }}>
              {detail}
            </div>
          </div>
        )}
        {chart}
      </div>
    );
  } else if (wide) {
    body = (
      <div style={{ display: 'grid', gridTemplateColumns: detail ? 'minmax(0, 1fr) 420px' : 'minmax(0, 1fr)', gap: 20, alignItems: 'start' }}>
        {list()}
        {detail && <div style={{ position: 'sticky', top: 96, maxHeight: 'calc(100vh - 120px)', overflowY: 'auto' }}>{detail}</div>}
      </div>
    );
  } else {
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {detail}
        {view === 'radar' ? chart : list()}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {stale && (
        <div role="status" style={{ border: `1px solid ${c.border}`, borderRadius: 8, padding: '10px 14px', background: c.surfaceSubtle, color: c.textSecondary, fontSize: '0.8125rem' }}>
          Showing a saved copy: GitHub could not be reached just now.
        </div>
      )}
      <HowToRead radar={radar} />
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 480px', minWidth: 0 }}>
          <RadarFilters filters={state.filters} blips={radar.blips} rings={radar.rings} shown={visible.length} onChange={filters => onChange({ filters })} searchRef={searchRef} />
        </div>
        <div style={{ display: 'flex' }} role="group" aria-label="View">
          {toggle('radar', 'Radar', <RadarIcon size={16} strokeWidth={1.5} aria-hidden="true" />)}
          {toggle('list', 'List', <List size={16} strokeWidth={1.5} aria-hidden="true" />)}
        </div>
      </div>
      {body}
    </div>
  );
};
