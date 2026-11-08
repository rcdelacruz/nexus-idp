import React from 'react';
import { useColors } from '@stratpoint/theme-utils';
import { Blip, QUADRANTS, QuadrantId, RingDef, blipLabel, movementLabel, quadrantName, ringDef } from './radarModel';
import { CENTER, DOT_R, LABEL_FONT, Labelled, RING_OUTER, SIZE, ringNameAt, viewBoxFor } from './radarLayout';
import { ringColor } from './radarColors';

const TITLE_ANCHOR: Record<QuadrantId, { x: number; y: number; anchor: 'start' | 'end' }> = {
  tools: { x: 24, y: 34, anchor: 'start' },
  techniques: { x: SIZE - 24, y: 34, anchor: 'end' },
  'languages-and-frameworks': { x: 24, y: SIZE - 28, anchor: 'start' },
  platforms: { x: SIZE - 24, y: SIZE - 28, anchor: 'end' },
};

interface Props {
  blips: Blip[];
  /** Where each dot and its name go (radarLayout.placeLabelled). */
  labelled: Map<string, Labelled>;
  visibleIds: Set<string>;
  rings: RingDef[];
  selectedId?: string;
  hoverId?: string;
  zoom?: QuadrantId;
  onSelect: (id: string) => void;
  onHover: (id?: string) => void;
  onZoom: (quadrant?: QuadrantId) => void;
}

/** What the hover card says (also the first thing a screen reader hears). */
function tooltipLines(b: Blip): string[] {
  const lines = [b.name, `${ringDef(b.ring).name} · ${quadrantName(b.quadrant)}`];
  if (b.movement !== 'none') lines.push(movementLabel[b.movement]);
  return lines;
}

export const RadarChart = ({ blips, labelled, visibleIds, rings, selectedId, hoverId, zoom, onSelect, onHover, onZoom }: Props) => {
  const c = useColors();
  const ringNameByRank = new Map(rings.map(r => [r.rank, r.name]));

  // Every technology is named beside its dot (the layout is the same whether or not a quadrant is
  // zoomed: zooming only magnifies).
  const where = (b: Blip) => labelled.get(b.id);
  const dotR = DOT_R;
  const fs = zoom ? 6.5 : 8.5;

  const counts = new Map<QuadrantId, number>();
  blips.forEach(b => visibleIds.has(b.id) && counts.set(b.quadrant, (counts.get(b.quadrant) ?? 0) + 1));
  const hovered = hoverId ? blips.find(b => b.id === hoverId) : undefined;
  const shown = blips.filter(b => (zoom ? b.quadrant === zoom : true));
  const ordered = [...shown].sort((a, b) => Number(visibleIds.has(a.id)) - Number(visibleIds.has(b.id)));

  const tip = (() => {
    if (!hovered) return null;
    const p = where(hovered);
    if (!p) return null;
    const lines = tooltipLines(hovered);
    const w = Math.max(...lines.map((l, i) => l.length * fs * (i === 0 ? 0.6 : 0.54))) + fs * 1.6;
    const h = lines.length * fs * 1.45 + fs * 0.9;
    const [vx, vy, vw, vh] = viewBoxFor(zoom).split(' ').map(Number);
    const x = Math.min(vx + vw - w - 2, Math.max(vx + 2, p.x - w / 2));
    const above = p.y - dotR - 6 - h >= vy + 2;
    const y = above ? p.y - dotR - 6 - h : Math.min(vy + vh - h - 2, p.y + dotR + 6);
    return { x, y, w, h, lines };
  })();

  return (
    <svg
      viewBox={viewBoxFor(zoom)}
      role="group"
      aria-label={`Technology radar: ${visibleIds.size} of ${blips.length} technologies shown`}
      style={{ display: 'block', width: '100%', maxWidth: zoom ? 760 : 820, margin: '0 auto', height: 'auto' }}
    >
      {[3, 2, 1, 0].map(rank => (
        <circle key={rank} cx={CENTER} cy={CENTER} r={RING_OUTER[rank]} fill={rank % 2 ? c.surface : c.surfaceSubtle} stroke={c.borderHover} strokeWidth={1} />
      ))}
      <line x1={0} y1={CENTER} x2={SIZE} y2={CENTER} stroke={c.borderHover} />
      <line x1={CENTER} y1={0} x2={CENTER} y2={SIZE} stroke={c.borderHover} />

      {QUADRANTS.filter(q => !zoom || q.id === zoom).flatMap(q =>
        [0, 1, 2, 3].map(rank => {
        const at = ringNameAt(rank, q.id);
        return (
        <text
          key={`${q.id}-${rank}`}
          x={at.x}
          y={at.y + 4}
          textAnchor={at.anchor}
          fontSize={11}
          fontWeight={600}
          letterSpacing="0.06em"
          fill={c.textMuted}
          stroke={rank % 2 ? c.surface : c.surfaceSubtle}
          strokeWidth={4}
          paintOrder="stroke"
          style={{ textTransform: 'uppercase', pointerEvents: 'none' }}
        >
          {ringNameByRank.get(rank) ?? ''}
        </text>
        );
        }),
      )}

      {QUADRANTS.filter(q => !zoom || q.id === zoom).map(q => {
        // Zoomed in, the other quadrants' titles are out of view: they are not rendered at all, so
        // they cannot be tabbed to.
        const t = TITLE_ANCHOR[q.id];
        const active = zoom === q.id;
        const toggle = () => onZoom(active ? undefined : q.id);
        return (
          <g
            key={q.id}
            role="button"
            tabIndex={0}
            aria-label={active ? 'Show the whole radar' : `Magnify ${q.name}`}
            onClick={toggle}
            onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggle())}
            style={{ cursor: 'pointer', outlineOffset: 4 }}
          >
            <title>{active ? 'Show the whole radar' : `Magnify ${q.name}`}</title>
            <text x={t.x} y={t.y} textAnchor={t.anchor} fontSize={16} fontWeight={600} letterSpacing="-0.01em" fill={c.text}>
              {q.name}
            </text>
            <text x={t.x} y={t.y + 17} textAnchor={t.anchor} fontSize={12} fill={c.blue}>
              {counts.get(q.id) ?? 0} {active ? '· ← whole radar' : '· magnify →'}
            </text>
          </g>
        );
      })}

      {ordered.map(b => {
        const p = where(b);
        if (!p) return null;
        const visible = visibleIds.has(b.id);
        const selected = b.id === selectedId;
        const emphasised = b.id === hoverId;
        const related = !!hovered && (hovered.related.includes(b.id) || b.related.includes(hovered.id));
        const dimmed = !!hoverId && !emphasised && !related;
        let opacity = 1;
        if (!visible) opacity = 0.12;
        else if (dimmed) opacity = 0.45;
        const label = labelled.get(b.id);
        const select = () => onSelect(b.id);
        return (
          <g
            key={b.id}
            data-blip-id={b.id}
            opacity={opacity}
            role="button"
            tabIndex={visible ? 0 : -1}
            aria-hidden={visible ? undefined : true}
            aria-pressed={selected}
            aria-label={blipLabel(b)}
            onClick={visible ? select : undefined}
            onKeyDown={e => visible && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), select())}
            onMouseEnter={visible ? () => onHover(b.id) : undefined}
            onMouseLeave={visible ? () => onHover(undefined) : undefined}
            onFocus={visible ? () => onHover(b.id) : undefined}
            onBlur={visible ? () => onHover(undefined) : undefined}
            style={{ cursor: visible ? 'pointer' : 'default', pointerEvents: visible ? 'auto' : 'none', outlineOffset: 3 }}
          >
            {/* A generous invisible target, so the dot is easy to hit. */}
            <circle cx={p.x} cy={p.y} r={dotR + 3} fill="transparent" />
            {label && visible && <rect x={Math.min(p.x, p.x + label.dir * (DOT_R + 3 + label.width))} y={p.y - 5} width={DOT_R + 3 + label.width} height={10} fill="transparent" />}
            {selected && <circle cx={p.x} cy={p.y} r={dotR + 3.5} fill="none" stroke={c.text} strokeWidth={1.2} />}
            <circle cx={p.x} cy={p.y} r={emphasised ? dotR * 1.35 : dotR} fill={ringColor(b.ring)} stroke={c.surface} strokeWidth={0.8} />
            {label && visible && (
              <text
                x={p.x + label.dir * (DOT_R + 3)}
                y={p.y + LABEL_FONT * 0.35}
                textAnchor={label.dir === 1 ? 'start' : 'end'}
                fontSize={LABEL_FONT}
                fontWeight={selected || emphasised ? 700 : 500}
                fill={c.text}
                stroke={c.surface}
                strokeWidth={2.4}
                paintOrder="stroke"
                style={{ pointerEvents: 'none' }}
              >
                {label.text}
              </text>
            )}
          </g>
        );
      })}

      {tip && (
        <g style={{ pointerEvents: 'none' }} aria-hidden="true">
          <rect x={tip.x} y={tip.y} width={tip.w} height={tip.h} rx={fs * 0.4} fill={c.text} opacity={0.96} />
          {tip.lines.map((line, i) => (
            <text key={i} x={tip.x + fs * 0.8} y={tip.y + fs * 0.45 + fs * 1.45 * (i + 1) - fs * 0.25} fontSize={fs} fontWeight={i === 0 ? 700 : 400} fill={c.bg}>
              {line}
            </text>
          ))}
        </g>
      )}
    </svg>
  );
};
