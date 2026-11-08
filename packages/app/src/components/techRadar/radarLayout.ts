/**
 * Where each technology is drawn, and where its name goes. The radar shows EVERY name beside its dot
 * (nothing to click or hover to read), so each item is a dot plus a text label, and the layout makes
 * sure no two labels, and no label and ring name, run into each other.
 *
 * Pure and deterministic: positions depend only on the blips, so a technology is in the same place on
 * every visit, and zooming into a quadrant only magnifies it.
 *
 * The radar is a circle in an 800x800 box split into four quadrant sectors and four rings.
 */
import { Blip, QuadrantId } from './radarModel';

export const SIZE = 800;
export const CENTER = SIZE / 2;
export const RADIUS = 380;

/** Outer radius of each ring rank (0 = centre). */
export const RING_OUTER = [130, 215, 300, RADIUS];
export const ringInner = (rank: number): number => (rank === 0 ? 0 : RING_OUTER[rank - 1]);

/** Dot radius, label font size and (estimated) character width, in SVG units. */
export const DOT_R = 4.5;
export const LABEL_FONT = 7.2;
const CHAR_W = LABEL_FONT * 0.56;
const MAX_LABEL_CHARS = 28;
const LABEL_H = 10;
const PAD = DOT_R + 3;

/** Angular range of each quadrant in SVG angles (radians, y down, atan2 range). */
const HALF_PI = Math.PI / 2;
export const SECTORS: Record<QuadrantId, { start: number; end: number }> = {
  techniques: { start: -HALF_PI, end: 0 }, // top right
  tools: { start: -Math.PI, end: -HALF_PI }, // top left
  'languages-and-frameworks': { start: HALF_PI, end: Math.PI }, // bottom left
  platforms: { start: 0, end: HALF_PI }, // bottom right
};

export interface Position {
  x: number;
  y: number;
}

/** The ring rank a blip sits in (`hold` and `caution` are both the outermost ring). */
const RANK: Record<string, number> = { adopt: 0, trial: 1, assess: 2 };
export const rankOf = (ring: string): number => RANK[ring] ?? 3;

const isRight = (q: QuadrantId): boolean => q === 'techniques' || q === 'platforms';
const isTop = (q: QuadrantId): boolean => q === 'techniques' || q === 'tools';

/**
 * Where a ring's name is printed in a quadrant: beside that quadrant's vertical axis, inside the
 * quadrant, so it is visible when zoomed in and never cut off.
 */
export function ringNameAt(rank: number, quadrant: QuadrantId): { x: number; y: number; anchor: 'start' | 'end' } {
  const mid = (ringInner(rank) + RING_OUTER[rank]) / 2;
  return {
    x: isRight(quadrant) ? CENTER + 6 : CENTER - 6,
    y: CENTER + (isTop(quadrant) ? -mid : mid),
    anchor: isRight(quadrant) ? 'start' : 'end',
  };
}

/** The box a ring's name occupies, for keeping dots and labels off it. */
export function ringNameBox(rank: number, quadrant: QuadrantId): { x0: number; x1: number; y0: number; y1: number } {
  const p = ringNameAt(rank, quadrant);
  const w = 58;
  return { x0: p.anchor === 'start' ? p.x : p.x - w, x1: p.anchor === 'start' ? p.x + w : p.x, y0: p.y - 8, y1: p.y + 8 };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

interface Cell {
  quadrant: QuadrantId;
  rank: number;
}

function clampToCell(p: Position, cell: Cell): Position {
  const dx = p.x - CENTER;
  const dy = p.y - CENTER;
  const rMin = Math.max(ringInner(cell.rank) + PAD, 26);
  const rMax = RING_OUTER[cell.rank] - PAD;
  const r = Math.min(rMax, Math.max(rMin, Math.hypot(dx, dy)));
  const { start, end } = SECTORS[cell.quadrant];
  const margin = Math.min(PAD / r, (end - start) / 2 - 0.01);
  // atan2 wraps at ±π, which the left-hand sectors straddle: bring the angle into the window that
  // is centred on this sector, or a dot nudged across the horizontal axis would snap to the far end.
  let angle = Math.atan2(dy, dx);
  const mid = (start + end) / 2;
  if (angle < mid - Math.PI) angle += 2 * Math.PI;
  if (angle >= mid + Math.PI) angle -= 2 * Math.PI;
  const theta = Math.min(end - margin, Math.max(start + margin, angle));
  return { x: CENTER + r * Math.cos(theta), y: CENTER + r * Math.sin(theta) };
}

/**
 * Slot k of a cell: a low-discrepancy (R2) sequence over the cell's area, so the dots start spread
 * evenly instead of in random clumps.
 */
const PLASTIC = 1.32471795724474602596;
const frac = (v: number): number => v - Math.floor(v);

function slot(k: number, cell: Cell): Position {
  const u = frac(0.5 + (k + 1) / PLASTIC);
  const v = frac(0.5 + (k + 1) / (PLASTIC * PLASTIC));
  const rMin = Math.max(ringInner(cell.rank) + PAD, 26);
  const rMax = RING_OUTER[cell.rank] - PAD;
  const r = Math.sqrt(rMin * rMin + u * (rMax * rMax - rMin * rMin)); // uniform over the area
  const { start, end } = SECTORS[cell.quadrant];
  const margin = PAD / r;
  const theta = start + margin + v * (end - start - 2 * margin);
  return { x: CENTER + r * Math.cos(theta), y: CENTER + r * Math.sin(theta) };
}

export interface Labelled {
  x: number;
  y: number;
  /** Which side of the dot the label is on: 1 = right, -1 = left. */
  dir: 1 | -1;
  /** The text to draw (shortened with an ellipsis when it cannot fit). */
  text: string;
  /** Estimated drawn width of `text`, in SVG units. */
  width: number;
}

export type LabelInput = Pick<Blip, 'id' | 'name' | 'quadrant' | 'ring' | 'movement'>;

const MOVEMENT_MARK: Record<string, string> = { 'moved-in': ' ▲', 'moved-out': ' ▼' };
const movementMark = (m: string): string => MOVEMENT_MARK[m] ?? '';

function shorten(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

interface Item {
  id: string;
  cell: Cell;
  full: string;
  x: number;
  y: number;
  dir: 1 | -1;
  text: string;
  width: number;
}

type Box = { x0: number; x1: number; y0: number; y1: number };

function boxOf(it: Pick<Item, 'x' | 'y' | 'dir' | 'width'>): Box {
  const near = DOT_R + 1.5;
  const far = DOT_R + 3 + it.width;
  return it.dir === 1
    ? { x0: it.x - near, x1: it.x + far, y0: it.y - LABEL_H / 2, y1: it.y + LABEL_H / 2 }
    : { x0: it.x - far, x1: it.x + near, y0: it.y - LABEL_H / 2, y1: it.y + LABEL_H / 2 };
}

/** The footprint (dot + label) of a placed item. */
export const footprint = (l: Labelled): Box => boxOf(l);

/** Picks the label side with room, and shortens the text to fit when neither side has enough. */
function fitLabel(it: Item, xMin: number, xMax: number): void {
  const outward: 1 | -1 = it.x >= CENTER ? 1 : -1;
  const room = (dir: 1 | -1) => (dir === 1 ? xMax - (it.x + DOT_R + 3) : it.x - DOT_R - 3 - xMin);
  const need = it.full.length * CHAR_W;
  let dir = outward;
  if (room(outward) < need && room(-outward as 1 | -1) > room(outward)) dir = -outward as 1 | -1;
  const maxChars = Math.max(4, Math.min(it.full.length, MAX_LABEL_CHARS, Math.floor(room(dir) / CHAR_W)));
  it.dir = dir;
  it.text = shorten(it.full, maxChars);
  it.width = it.text.length * CHAR_W;
}

function placeQuadrant(blips: LabelInput[], quadrant: QuadrantId): Item[] {
  const xMin = isRight(quadrant) ? CENTER + 3 : 3;
  const xMax = isRight(quadrant) ? SIZE - 3 : CENTER - 3;
  const yMin = isTop(quadrant) ? 3 : CENTER + 3;
  const yMax = isTop(quadrant) ? CENTER - 3 : SIZE - 3;

  const items: Item[] = [];
  const byRank = new Map<number, LabelInput[]>();
  for (const b of blips) {
    if (b.quadrant !== quadrant) continue;
    const rank = rankOf(b.ring);
    byRank.set(rank, [...(byRank.get(rank) ?? []), b]);
  }
  for (const [rank, list] of byRank) {
    const cell: Cell = { quadrant, rank };
    list.sort((a, b) => hash(a.id) - hash(b.id) || (a.id < b.id ? -1 : 1));
    list.forEach((b, k) => {
      const p = slot(k, cell);
      const full = `${b.name}${movementMark(b.movement)}`;
      items.push({ id: b.id, cell, full, x: p.x, y: p.y, dir: 1, text: full, width: full.length * CHAR_W });
    });
  }
  items.sort((a, b) => (a.id < b.id ? -1 : 1));

  const obstacles = RING_OUTER.map((_, rank) => ringNameBox(rank, quadrant));

  for (let pass = 0; pass < 500; pass++) {
    let worst = 0;
    for (const it of items) fitLabel(it, xMin, xMax);
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = boxOf(items[i]);
        const b = boxOf(items[j]);
        const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
        const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
        if (ox <= 0 || oy <= 0) continue;
        worst = Math.max(worst, Math.min(ox, oy));
        if (oy <= ox) {
          const tie = i % 2 ? 1 : -1;
          const s = items[i].y === items[j].y ? tie : Math.sign(items[i].y - items[j].y);
          items[i].y += (s * (oy + 0.1)) / 2;
          items[j].y -= (s * (oy + 0.1)) / 2;
        } else {
          const s = items[i].x === items[j].x ? 1 : Math.sign(items[i].x - items[j].x);
          items[i].x += (s * (ox + 0.1)) / 2;
          items[j].x -= (s * (ox + 0.1)) / 2;
        }
      }
      for (const o of obstacles) {
        const a = boxOf(items[i]);
        const ox = Math.min(a.x1, o.x1) - Math.max(a.x0, o.x0);
        const oy = Math.min(a.y1, o.y1) - Math.max(a.y0, o.y0);
        if (ox <= 0 || oy <= 0) continue;
        worst = Math.max(worst, Math.min(ox, oy));
        if (oy <= ox) items[i].y += (items[i].y >= (o.y0 + o.y1) / 2 ? 1 : -1) * (oy + 0.1);
        else items[i].x += (items[i].x >= (o.x0 + o.x1) / 2 ? 1 : -1) * (ox + 0.1);
      }
    }
    for (const it of items) {
      const p = clampToCell({ x: it.x, y: it.y }, it.cell);
      it.x = p.x;
      // Keep the label inside its own half, so it never reaches across the horizontal axis.
      it.y = Math.min(yMax - LABEL_H / 2, Math.max(yMin + LABEL_H / 2, p.y));
    }
    if (worst < 0.2) break;
  }
  for (const it of items) fitLabel(it, xMin, xMax);
  return items;
}

/**
 * Positions, label sides and label texts for every blip (all four quadrants), so that no two labels,
 * and no label and ring name, overlap. Dots stay inside their own ring and quadrant; labels are free
 * to run across ring lines, which is what makes the room.
 */
export function placeLabelled(blips: LabelInput[]): Map<string, Labelled> {
  const out = new Map<string, Labelled>();
  for (const q of Object.keys(SECTORS) as QuadrantId[]) {
    for (const it of placeQuadrant(blips, q)) out.set(it.id, { x: it.x, y: it.y, dir: it.dir, text: it.text, width: it.width });
  }
  return out;
}

/** The part of the 800x800 box to show: the whole radar, or one quadrant zoomed in. */
export function viewBoxFor(zoom?: QuadrantId): string {
  if (!zoom) return `0 0 ${SIZE} ${SIZE}`;
  const half = SIZE / 2;
  const x = isRight(zoom) ? half : 0;
  const y = isTop(zoom) ? 0 : half;
  return `${x} ${y} ${half} ${half}`;
}
