import { isJustCreated, justCreatedState } from './labArrival';

describe('lab arrival mark', () => {
  it('reads back the state it creates', () => {
    expect(isJustCreated(justCreatedState())).toBe(true);
  });

  it.each([
    ['no state', undefined],
    ['null', null],
    ['a string', 'labJustCreated'],
    ['an empty object', {}],
    ['a truthy non-boolean', { labJustCreated: 1 }],
    ['the string "true"', { labJustCreated: 'true' }],
    ['false', { labJustCreated: false }],
    ['the run page mark', { labRedirectAt: Date.now() }],
  ])('does not take %s for an arrival from Create', (_name, state) => {
    expect(isJustCreated(state)).toBe(false);
  });
});
