import sample from './__fixtures__/vol34-sample.json';
import { NO_FILTERS, RadarFormatError, blipLabel, countBy, filterBlips, isFiltered, parseRadar, slug, unescapeSourceHtml } from './radarModel';

// Real Vol. 34 names, quadrants, rings and statuses (descriptions are short placeholders).
const meta = { volume: 34, label: 'Vol. 34 · April 2026' };
const { radar, skipped } = parseRadar(sample, meta);

describe('parseRadar', () => {
  it('reads every technology in the volume', () => {
    expect(skipped).toBe(0);
    expect(radar.blips).toHaveLength(118);
    expect(radar.volumeLabel).toBe('Vol. 34 · April 2026');
  });

  it('keeps the new / moved signal the first version threw away (87 new, 17 moved in, 1 moved out)', () => {
    const by = countBy(radar.blips, b => b.movement);
    expect(by).toEqual({ new: 87, 'moved-in': 17, 'moved-out': 1, none: 13 });
  });

  it('gives every technology a unique id', () => {
    expect(new Set(radar.blips.map(b => b.id)).size).toBe(118);
  });

  it('disambiguates two technologies with the same name', () => {
    const two = parseRadar(
      [
        { name: 'Rust', quadrant: 'languages-and-frameworks', ring: 'adopt', status: 'no change', isNew: 'FALSE' },
        { name: 'Rust', quadrant: 'tools', ring: 'trial', status: 'no change', isNew: 'FALSE' },
      ],
      meta,
    );
    expect(two.radar.blips.map(b => b.id).sort()).toEqual(['rust', 'rust-2']);
  });

  it('keeps every id unique, even when a generated id collides with a real name', () => {
    const entries = ['Foo', 'Foo', 'Foo 2', 'Foo'].map(name => ({ name, quadrant: 'tools', ring: 'assess', status: 'no change', isNew: 'FALSE' }));
    const ids = parseRadar(entries, meta).radar.blips.map(b => b.id);
    expect(new Set(ids).size).toBe(4);
    expect(ids.sort()).toEqual(['foo', 'foo-2', 'foo-2-2', 'foo-3']);
  });

  it('lists only the rings in use, innermost first (Vol. 34 has Caution and no Hold)', () => {
    expect(radar.rings.map(r => r.id)).toEqual(['adopt', 'trial', 'assess', 'caution']);
    const withHold = parseRadar([{ name: 'X', quadrant: 'tools', ring: 'hold', status: 'no change', isNew: 'FALSE' }], meta);
    expect(withHold.radar.rings.map(r => r.id)).toEqual(['hold']);
    expect(withHold.radar.rings[0].rank).toBe(3);
  });

  it('links related technologies that exist in the volume, never to itself', () => {
    const withRelated = radar.blips.filter(b => b.related.length > 0);
    expect(withRelated.length).toBeGreaterThan(0);
    for (const b of withRelated) {
      expect(b.related).not.toContain(b.id);
      for (const id of b.related) expect(radar.blips.some(o => o.id === id)).toBe(true);
    }
  });

  it('skips malformed items and counts them, rather than throwing', () => {
    const result = parseRadar(
      [
        null,
        'x',
        { name: '', quadrant: 'tools', ring: 'adopt' },
        { name: 'No quadrant', ring: 'adopt' },
        { name: 'Bad ring', quadrant: 'tools', ring: 'nope' },
        { name: 'Good', quadrant: 'tools', ring: 'ADOPT', status: 'new', isNew: 'TRUE', description: 5, relatedBlips: 'x' },
      ],
      meta,
    );
    expect(result.skipped).toBe(5);
    expect(result.radar.blips).toHaveLength(1);
    expect(result.radar.blips[0]).toMatchObject({ name: 'Good', ring: 'adopt', movement: 'new', descriptionHtml: '', related: [] });
  });

  it('refuses data that is not a list', () => {
    expect(() => parseRadar({ blips: [] }, meta)).toThrow(RadarFormatError);
  });

  it('orders blips by quadrant, ring, then name (the list order)', () => {
    const first = radar.blips[0];
    expect(first.quadrant).toBe('languages-and-frameworks');
    expect(first.ring).toBe('adopt');
  });
});

describe('unescapeSourceHtml / slug', () => {
  it('undoes the CSV escaping in the source descriptions', () => {
    expect(unescapeSourceHtml('"<p>A ""quoted"" word</p>"')).toBe('<p>A "quoted" word</p>');
    expect(unescapeSourceHtml('  plain  ')).toBe('plain');
  });

  it('makes url-safe slugs', () => {
    expect(slug('Coding throughput as a measure of productivity!')).toBe('coding-throughput-as-a-measure-of-productivity');
    expect(slug('C#/.NET')).toBe('c-net');
  });
});

describe('filterBlips', () => {
  const count = (f: Partial<typeof NO_FILTERS>) => filterBlips(radar.blips, { ...NO_FILTERS, ...f }).length;

  it('shows everything with no filters', () => {
    expect(count({})).toBe(118);
    expect(isFiltered(NO_FILTERS)).toBe(false);
  });

  it('filters by quadrant and ring (counts from the real volume)', () => {
    expect(count({ quadrants: ['techniques'] })).toBe(41);
    expect(count({ quadrants: ['techniques', 'tools'] })).toBe(73);
    expect(count({ rings: ['adopt'] })).toBe(17);
    expect(count({ rings: ['caution'] })).toBe(9);
    expect(count({ quadrants: ['tools'], rings: ['assess'] })).toBe(20);
  });

  it('filters by what changed', () => {
    expect(count({ lens: 'new' })).toBe(87);
    expect(count({ lens: 'moved' })).toBe(18);
  });

  it('searches names and descriptions, case-insensitively, all words required', () => {
    expect(count({ q: 'passkeys' })).toBe(1);
    expect(count({ q: 'PASSKEYS' })).toBe(1);
    expect(count({ q: 'sample description' })).toBe(118); // in every placeholder description
    expect(count({ q: 'passkeys context' })).toBe(0);
    expect(count({ q: '   ' })).toBe(118);
  });

  it('finds names and text with entities (AT&T is stored as AT&amp;T)', () => {
    const r = parseRadar(
      [{ name: 'Telco', quadrant: 'tools', ring: 'assess', status: 'new', isNew: 'TRUE', description: '<p>Works with AT&amp;T and &quot;edge&quot; networks&nbsp;too</p>' }],
      meta,
    ).radar.blips;
    const found = (q: string) => filterBlips(r, { ...NO_FILTERS, q }).length;
    expect(found('at&t')).toBe(1);
    expect(found('"edge"')).toBe(1);
    expect(found('networks too')).toBe(1);
  });

  it('combines filters', () => {
    const names = filterBlips(radar.blips, { ...NO_FILTERS, quadrants: ['techniques'], rings: ['adopt'], lens: 'moved' }).map(b => b.name);
    expect(names).toEqual(['Context engineering', 'Passkeys', 'Structured output from LLMs']);
  });
});

describe('blipLabel', () => {
  it('is the accessible name: name, quadrant, ring, movement', () => {
    const passkeys = radar.blips.find(b => b.id === 'passkeys')!;
    expect(blipLabel(passkeys)).toBe('Passkeys, Techniques, Adopt, moved in (closer to adopting)');
  });
});
