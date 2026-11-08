/**
 * The radar's whole view state lives in the URL (search, quadrants, rings, lens, view, open blip),
 * so any view can be shared, bookmarked, and survives Back / refresh.
 */
import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Lens, QUADRANTS, QuadrantId, RINGS, RingId, RadarFilters } from './radarModel';

export type RadarView = 'radar' | 'list';

export interface RadarUrlState {
  filters: RadarFilters;
  view?: RadarView;
  blip?: string;
}

const QUADRANT_IDS = new Set<string>(QUADRANTS.map(q => q.id));
const RING_IDS = new Set<string>(RINGS.map(r => r.id));

function list<T extends string>(value: string | null, valid: Set<string>): T[] {
  return (value ?? '')
    .split(',')
    .map(s => s.trim())
    .filter((s): s is T => valid.has(s));
}

export function readUrlState(params: URLSearchParams): RadarUrlState {
  const lens = params.get('lens');
  const view = params.get('view');
  return {
    filters: {
      q: params.get('q') ?? '',
      quadrants: list<QuadrantId>(params.get('quadrant'), QUADRANT_IDS),
      rings: list<RingId>(params.get('ring'), RING_IDS),
      lens: lens === 'new' || lens === 'moved' ? (lens as Lens) : 'all',
    },
    view: view === 'radar' || view === 'list' ? view : undefined,
    blip: params.get('blip') || undefined,
  };
}

export function writeUrlState(state: RadarUrlState): URLSearchParams {
  const p = new URLSearchParams();
  if (state.filters.q.trim()) p.set('q', state.filters.q);
  if (state.filters.quadrants.length) p.set('quadrant', state.filters.quadrants.join(','));
  if (state.filters.rings.length) p.set('ring', state.filters.rings.join(','));
  if (state.filters.lens !== 'all') p.set('lens', state.filters.lens);
  if (state.view) p.set('view', state.view);
  if (state.blip) p.set('blip', state.blip);
  return p;
}

export function useRadarUrlState() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const state = useMemo(() => readUrlState(params), [params]);

  /**
   * `push` adds a history entry (opening a blip, so Back closes it); the default replaces (typing).
   * Closing a blip that this page opened steps back in history instead of adding another entry, so
   * Back never lands on an identical-looking page.
   */
  const update = useCallback(
    (patch: Partial<RadarUrlState>, options: { push?: boolean } = {}) => {
      const closingOnly = 'blip' in patch && patch.blip === undefined && Object.keys(patch).length === 1;
      if (closingOnly && (location.state as { radarOpened?: boolean } | null)?.radarOpened) {
        navigate(-1);
        return;
      }
      const next: RadarUrlState = { ...state, ...patch, filters: { ...state.filters, ...patch.filters } };
      // Pushing marks the new entry as opened by this page; replacing keeps whatever mark it had.
      setParams(writeUrlState(next), { replace: !options.push, state: options.push ? { radarOpened: true } : location.state });
    },
    [state, setParams, navigate, location.state],
  );

  return { state, update };
}
