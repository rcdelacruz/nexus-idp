import { NO_FILTERS } from './radarModel';
import { readUrlState, writeUrlState } from './useRadarUrlState';

describe('radar URL state', () => {
  it('reads every part of the view from the URL', () => {
    const s = readUrlState(new URLSearchParams('q=agents&quadrant=tools,techniques&ring=adopt,trial&lens=new&view=list&blip=passkeys'));
    expect(s).toEqual({
      filters: { q: 'agents', quadrants: ['tools', 'techniques'], rings: ['adopt', 'trial'], lens: 'new' },
      view: 'list',
      blip: 'passkeys',
    });
  });

  it('ignores anything it does not know, so a bad link still opens the radar', () => {
    const s = readUrlState(new URLSearchParams('quadrant=tools,bogus&ring=nope&lens=weird&view=cube'));
    expect(s).toEqual({ filters: { q: '', quadrants: ['tools'], rings: [], lens: 'all' }, view: undefined, blip: undefined });
  });

  it('writes only what differs from the defaults', () => {
    expect(writeUrlState({ filters: NO_FILTERS }).toString()).toBe('');
    expect(writeUrlState({ filters: { ...NO_FILTERS, q: 'ai', lens: 'moved' }, blip: 'x' }).toString()).toBe('q=ai&lens=moved&blip=x');
  });

  it('round-trips', () => {
    const state = { filters: { q: 'a b', quadrants: ['platforms' as const], rings: ['caution' as const], lens: 'moved' as const }, view: 'radar' as const, blip: 'z' };
    expect(readUrlState(writeUrlState(state))).toEqual(state);
  });
});
