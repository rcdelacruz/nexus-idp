import { isFreshRun, LAB_REDIRECT_WINDOW_MS, newRunState } from './labRedirect';

const NOW = 1_800_000_000_000;

describe('isFreshRun', () => {
  it('accepts the state the wizard creates', () => {
    expect(isFreshRun(newRunState(NOW), NOW)).toBe(true);
  });

  it('accepts a run for the whole window, and not a millisecond longer', () => {
    expect(isFreshRun(newRunState(NOW), NOW + LAB_REDIRECT_WINDOW_MS)).toBe(true);
    expect(isFreshRun(newRunState(NOW), NOW + LAB_REDIRECT_WINDOW_MS + 1)).toBe(false);
  });

  it('refuses a mark from the future (the clock moved back)', () => {
    expect(isFreshRun(newRunState(NOW + 1), NOW)).toBe(false);
  });

  it.each([
    ['no state', undefined],
    ['null', null],
    ['a string', 'labRedirectAt'],
    ['a number', 5],
    ['an empty object', {}],
    ['a non-number mark', { labRedirectAt: '1800000000000' }],
    ['NaN', { labRedirectAt: Number.NaN }],
    ['Infinity', { labRedirectAt: Number.POSITIVE_INFINITY }],
    ['another key', { startedAt: NOW }],
  ])('refuses %s', (_name, state) => {
    expect(isFreshRun(state, NOW)).toBe(false);
  });
});
