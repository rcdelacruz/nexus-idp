/**
 * The tech radar's data model and the pure functions over it (parse, filter, group). No React.
 *
 * Source: the public Thoughtworks Technology Radar volumes
 * (github.com/setchy/thoughtworks-tech-radar-volumes). The mapping keeps what the first version
 * threw away: `isNew` / `status` (87 of 118 blips in Vol. 34 are new, 17 moved in) and
 * `relatedBlips`.
 */

export type QuadrantId = 'languages-and-frameworks' | 'platforms' | 'techniques' | 'tools';
export type RingId = 'adopt' | 'trial' | 'assess' | 'hold' | 'caution';
export type Movement = 'new' | 'moved-in' | 'moved-out' | 'none';
export type Lens = 'all' | 'new' | 'moved';

export interface QuadrantDef {
  id: QuadrantId;
  name: string;
}

export interface RingDef {
  id: RingId;
  name: string;
  /** 0 = centre. `hold` and `caution` are both the outermost ring (a volume uses one or the other). */
  rank: number;
  description: string;
}

export const QUADRANTS: QuadrantDef[] = [
  { id: 'languages-and-frameworks', name: 'Languages & Frameworks' },
  { id: 'platforms', name: 'Platforms' },
  { id: 'techniques', name: 'Techniques' },
  { id: 'tools', name: 'Tools' },
];

export const RINGS: RingDef[] = [
  { id: 'adopt', name: 'Adopt', rank: 0, description: 'We strongly recommend this technology. Use it when appropriate.' },
  { id: 'trial', name: 'Trial', rank: 1, description: 'Worth pursuing. Understand how to build this capability.' },
  { id: 'assess', name: 'Assess', rank: 2, description: 'Worth exploring to understand how it will affect your enterprise.' },
  { id: 'caution', name: 'Caution', rank: 3, description: 'Approach with significant care: known risks that need deliberate mitigation.' },
  { id: 'hold', name: 'Hold', rank: 3, description: 'Proceed with caution.' },
];

export interface Blip {
  id: string;
  name: string;
  quadrant: QuadrantId;
  ring: RingId;
  movement: Movement;
  /** Raw description HTML from the source: only ever rendered through descriptionHtml.tsx. */
  descriptionHtml: string;
  /** Ids of related blips that exist in this volume. */
  related: string[];
  url: string;
  /** Lower-case name + plain-text description, for search. */
  searchText: string;
}

export interface Radar {
  volume: number;
  volumeLabel: string;
  blips: Blip[];
  /** Rings that at least one blip uses, innermost first (so a volume without Hold shows no Hold ring). */
  rings: RingDef[];
}

export interface VolumeMeta {
  volume: number;
  label: string;
}

export class RadarFormatError extends Error {}

const QUADRANT_IDS = new Set<string>(QUADRANTS.map(q => q.id));
const RING_BY_ID = new Map<string, RingDef>(RINGS.map(r => [r.id, r]));

export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** The source's descriptions are CSV-escaped HTML: surrounding quotes and "" for every ". */
export function unescapeSourceHtml(raw: string): string {
  return raw.trim().replace(/^"+|"+$/g, '').replace(/""/g, '"').trim();
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** The description as plain text (tags removed, common entities decoded), for search. */
function plainText(html: string): string {
  return unescapeSourceHtml(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#39|#x27|amp|lt|gt|quot|apos|nbsp);/gi, (_m, e: string) => (e.startsWith('#') ? "'" : ENTITIES[e.toLowerCase()]))
    .replace(/\s+/g, ' ')
    .trim();
}

function movementOf(status: unknown, isNew: unknown): Movement {
  const s = typeof status === 'string' ? status.toLowerCase() : '';
  if (s === 'new' || isNew === 'TRUE' || isNew === true) return 'new';
  if (s === 'moved in') return 'moved-in';
  if (s === 'moved out') return 'moved-out';
  return 'none';
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Builds a Radar from a volume's JSON. The input is third-party data: anything malformed is
 * skipped (and counted), never thrown on, unless the whole file is not a list.
 */
export function parseRadar(raw: unknown, meta: VolumeMeta): { radar: Radar; skipped: number } {
  if (!Array.isArray(raw)) throw new RadarFormatError('The radar data is not a list');

  let skipped = 0;
  const seen = new Set<string>();
  const drafts: Omit<Blip, 'related'>[] = [];
  const relatedNames = new Map<string, string[]>();

  for (const item of raw) {
    if (!isObject(item) || typeof item.name !== 'string' || !item.name.trim()) {
      skipped++;
      continue;
    }
    const quadrant = typeof item.quadrant === 'string' ? item.quadrant : '';
    const ring = typeof item.ring === 'string' ? item.ring.toLowerCase() : '';
    if (!QUADRANT_IDS.has(quadrant) || !RING_BY_ID.has(ring)) {
      skipped++;
      continue;
    }
    const name = item.name.trim();
    const base = slug(name) || 'blip';
    let id = base;
    // Two technologies can share a name (or a slug): keep every id unique, even against "Foo 2".
    for (let n = 2; seen.has(id); n++) id = `${base}-${n}`;
    seen.add(id);

    const descriptionHtml = typeof item.description === 'string' ? item.description : '';
    drafts.push({
      id,
      name,
      quadrant: quadrant as QuadrantId,
      ring: ring as RingId,
      movement: movementOf(item.status, item.isNew),
      descriptionHtml,
      url: `https://www.thoughtworks.com/radar/${quadrant}/${slug(name)}`,
      searchText: `${name} ${plainText(descriptionHtml)}`.toLowerCase(),
    });
    relatedNames.set(
      id,
      Array.isArray(item.relatedBlips) ? item.relatedBlips.filter((r): r is string => typeof r === 'string') : [],
    );
  }

  const quadrantOrder = new Map(QUADRANTS.map((q, i) => [q.id, i]));
  drafts.sort(
    (a, b) =>
      quadrantOrder.get(a.quadrant)! - quadrantOrder.get(b.quadrant)! ||
      RING_BY_ID.get(a.ring)!.rank - RING_BY_ID.get(b.ring)!.rank ||
      a.name.localeCompare(b.name),
  );

  const idByName = new Map(drafts.map(d => [d.name.toLowerCase(), d.id]));
  const blips: Blip[] = drafts.map(d => ({
    ...d,
    related: (relatedNames.get(d.id) ?? [])
      .map(name => idByName.get(name.toLowerCase()))
      .filter((rid): rid is string => !!rid && rid !== d.id),
  }));

  const usedRings = new Set(blips.map(b => b.ring));
  const rings = RINGS.filter(r => usedRings.has(r.id)).sort((a, b) => a.rank - b.rank);

  return { radar: { volume: meta.volume, volumeLabel: meta.label, blips, rings }, skipped };
}

export interface RadarFilters {
  q: string;
  quadrants: QuadrantId[];
  rings: RingId[];
  lens: Lens;
}

export const NO_FILTERS: RadarFilters = { q: '', quadrants: [], rings: [], lens: 'all' };

export function isFiltered(f: RadarFilters): boolean {
  return !!f.q.trim() || f.quadrants.length > 0 || f.rings.length > 0 || f.lens !== 'all';
}

export function matchesFilters(blip: Blip, f: RadarFilters): boolean {
  if (f.quadrants.length && !f.quadrants.includes(blip.quadrant)) return false;
  if (f.rings.length && !f.rings.includes(blip.ring)) return false;
  if (f.lens === 'new' && blip.movement !== 'new') return false;
  if (f.lens === 'moved' && blip.movement !== 'moved-in' && blip.movement !== 'moved-out') return false;
  const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  return words.every(w => blip.searchText.includes(w));
}

export function filterBlips(blips: Blip[], f: RadarFilters): Blip[] {
  return blips.filter(b => matchesFilters(b, f));
}

export function countBy<K extends string>(blips: Blip[], key: (b: Blip) => K): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of blips) out[key(b)] = (out[key(b)] ?? 0) + 1;
  return out;
}

export const quadrantName = (id: QuadrantId): string => QUADRANTS.find(q => q.id === id)?.name ?? id;
export const ringDef = (id: RingId): RingDef => RING_BY_ID.get(id)!;

export const movementLabel: Record<Movement, string> = {
  new: 'New in this volume',
  'moved-in': 'Moved in (closer to adopting)',
  'moved-out': 'Moved out',
  none: 'No change',
};

/** "Rust, Languages & Frameworks, Trial, new in this volume": the blip's accessible name. */
export function blipLabel(b: Blip): string {
  const move = b.movement === 'none' ? '' : `, ${movementLabel[b.movement].toLowerCase()}`;
  return `${b.name}, ${quadrantName(b.quadrant)}, ${ringDef(b.ring).name}${move}`;
}
