import sample from './__fixtures__/vol34-sample.json';
import { parseRadar, QUADRANTS, QuadrantId } from './radarModel';
import {
  CENTER,
  RING_OUTER,
  SECTORS,
  footprint,
  placeLabelled,
  rankOf,
  ringInner,
  ringNameBox,
} from './radarLayout';

// Real Vol. 34 names, quadrants and rings (descriptions are placeholders): the cell sizes and name
// lengths that make or break a layout.
const { radar } = parseRadar(sample, { volume: 34, label: 'Vol. 34' });

const inCell = (
  x: number,
  y: number,
  quadrant: QuadrantId,
  rank: number,
  slack = 0.5,
) => {
  const r = Math.hypot(x - CENTER, y - CENTER);
  const theta = Math.atan2(y - CENTER, x - CENTER);
  const { start, end } = SECTORS[quadrant];
  return (
    r >= ringInner(rank) - slack &&
    r <= RING_OUTER[rank] + slack &&
    theta >= start - 1e-6 &&
    theta <= end + 1e-6
  );
};

describe('placeLabelled (every name drawn beside its dot)', () => {
  const placed = placeLabelled(radar.blips);

  it('places every blip, and is deterministic (same place every visit)', () => {
    expect(placed.size).toBe(radar.blips.length);
    const again = placeLabelled([...radar.blips].reverse());
    for (const [id, p] of placed) expect(again.get(id)).toEqual(p);
  });

  it('keeps names from crossing the horizontal axis into the other half', () => {
    const crossing = radar.blips.filter(b => {
      const box = footprint(placed.get(b.id)!);
      const top = b.quadrant === 'techniques' || b.quadrant === 'tools';
      return top ? box.y1 > CENTER : box.y0 < CENTER;
    });
    expect(crossing).toEqual([]);
  });

  describe.each(QUADRANTS.map(q => [q.name, q] as const))('%s', (_name, q) => {
    const mine = radar.blips.filter(b => b.quadrant === q.id);

    it('places only this quadrant, each dot in its own ring', () => {
      for (const b of mine) {
        const p = placed.get(b.id)!;
        expect(inCell(p.x, p.y, b.quadrant, rankOf(b.ring), 1)).toBe(true);
      }
    });

    it('never lets two names (or a name and a ring name) overlap', () => {
      const boxes = mine.map(b => footprint(placed.get(b.id)!));
      let worst = 0;
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const ox =
            Math.min(boxes[i].x1, boxes[j].x1) -
            Math.max(boxes[i].x0, boxes[j].x0);
          const oy =
            Math.min(boxes[i].y1, boxes[j].y1) -
            Math.max(boxes[i].y0, boxes[j].y0);
          if (ox > 0 && oy > 0) worst = Math.max(worst, Math.min(ox, oy));
        }
        for (let rank = 0; rank < RING_OUTER.length; rank++) {
          const name = ringNameBox(rank, q.id);
          const ox =
            Math.min(boxes[i].x1, name.x1) - Math.max(boxes[i].x0, name.x0);
          const oy =
            Math.min(boxes[i].y1, name.y1) - Math.max(boxes[i].y0, name.y0);
          if (ox > 0 && oy > 0) worst = Math.max(worst, Math.min(ox, oy));
        }
      }
      expect(worst).toBeLessThan(0.5);
    });

    it('keeps every name inside the quadrant being shown', () => {
      const right = q.id === 'techniques' || q.id === 'platforms';
      const outside = mine.filter(b => {
        const box = footprint(placed.get(b.id)!);
        const wrongHalf = right ? box.x0 < CENTER : box.x1 > CENTER;
        return wrongHalf || box.x0 < 0 || box.x1 > 2 * CENTER;
      });
      expect(outside).toEqual([]);
    });

    it('only shortens a name when it has to, and says so with an ellipsis', () => {
      for (const b of mine) {
        const l = placed.get(b.id)!;
        const mark =
          { 'moved-in': ' ▲', 'moved-out': ' ▼' }[b.movement as string] ?? '';
        const full = b.name + mark;
        expect(l.text === full || l.text.endsWith('…')).toBe(true);
      }
    });
  });
});
