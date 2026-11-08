import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { TestApiProvider } from '@backstage/test-utils';
import { AppThemeSelector } from '@backstage/core-app-api';
import { appThemeApiRef } from '@backstage/core-plugin-api';
import { DEFAULT_DARK, DEFAULT_LIGHT, PALETTES, THEME_IDS, themeIsDark } from '@stratpoint/theme-utils';
import { otherModeTheme, rememberTheme, resolveThemeId, useActiveThemeId } from './themePreference';

describe('resolveThemeId', () => {
  it('uses a saved theme as it is', () => {
    for (const id of THEME_IDS) {
      expect(resolveThemeId(id, true)).toBe(id);
      expect(resolveThemeId(id, false)).toBe(id);
    }
  });

  it('follows the device when nothing is saved (Auto)', () => {
    expect(resolveThemeId(undefined, true)).toBe(DEFAULT_DARK);
    expect(resolveThemeId(undefined, false)).toBe(DEFAULT_LIGHT);
    expect(resolveThemeId(null, true)).toBe(DEFAULT_DARK);
  });

  it('follows the device when the saved theme does not exist any more', () => {
    expect(resolveThemeId('dark-v2', true)).toBe(DEFAULT_DARK);
    expect(resolveThemeId('dark-v2', false)).toBe(DEFAULT_LIGHT);
    expect(resolveThemeId('constructor', true)).toBe(DEFAULT_DARK);
  });

  it('agrees with Backstage\'s own Auto, which picks the first light or dark theme that is registered', () => {
    expect(THEME_IDS.find(id => themeIsDark(id))).toBe(DEFAULT_DARK);
    expect(THEME_IDS.find(id => !themeIsDark(id))).toBe(DEFAULT_LIGHT);
  });
});

describe('useActiveThemeId', () => {
  const themes = THEME_IDS.map(id => ({ id, title: PALETTES[id].name, variant: PALETTES[id].isDark ? 'dark' : 'light', Provider: () => null })) as any[];
  const original = window.matchMedia;
  let darkDevice = false;
  let notify: Array<(e: { matches: boolean }) => void> = [];

  beforeEach(() => {
    darkDevice = false;
    notify = [];
    window.matchMedia = ((query: string) => ({
      media: query,
      get matches() {
        return darkDevice;
      },
      addEventListener: (_: string, cb: any) => notify.push(cb),
      removeEventListener: (_: string, cb: any) => {
        notify = notify.filter(n => n !== cb);
      },
    })) as any;
  });
  afterEach(() => {
    window.matchMedia = original;
  });

  const render = (saved?: string) => {
    const selector = new AppThemeSelector(themes);
    selector.setActiveThemeId(saved);
    const wrapper = ({ children }: { children: React.ReactNode }) => <TestApiProvider apis={[[appThemeApiRef, selector]]}>{children}</TestApiProvider>;
    return { selector, ...renderHook(() => useActiveThemeId(), { wrapper }) };
  };

  it('is the saved theme', async () => {
    const { result } = render('dark-warm');
    await act(async () => {});
    expect(result.current).toBe('dark-warm');
  });

  it('in Auto, is the dark default on a dark device and the light default on a light one', async () => {
    darkDevice = true;
    const dark = render(undefined);
    await act(async () => {});
    expect(dark.result.current).toBe(DEFAULT_DARK);
    dark.unmount();

    darkDevice = false;
    const light = render(undefined);
    await act(async () => {});
    expect(light.result.current).toBe(DEFAULT_LIGHT);
  });

  it('in Auto, follows the device when it switches while the page is open', async () => {
    const { result } = render(undefined);
    await act(async () => {});
    expect(result.current).toBe(DEFAULT_LIGHT);
    darkDevice = true;
    await act(async () => notify.forEach(n => n({ matches: true })));
    expect(result.current).toBe(DEFAULT_DARK);
  });

  it('follows a change made elsewhere (the Settings picker, the sidebar button)', async () => {
    const { result, selector } = render('light');
    await act(async () => {});
    expect(result.current).toBe('light');
    await act(async () => selector.setActiveThemeId('dark-midnight'));
    expect(result.current).toBe('dark-midnight');
    await act(async () => selector.setActiveThemeId(undefined));
    expect(result.current).toBe(DEFAULT_LIGHT); // Auto on a light device
  });
});

describe('the sun/moon button', () => {
  beforeEach(() => window.localStorage.clear());

  it('returns to the last theme used in the other mode', () => {
    rememberTheme('dark-midnight');
    rememberTheme('light-classic');
    expect(otherModeTheme('light-classic')).toBe('dark-midnight');
    expect(otherModeTheme('dark-midnight')).toBe('light-classic');
  });

  it('falls back to the defaults when nothing was used yet', () => {
    expect(otherModeTheme('light')).toBe(DEFAULT_DARK);
    expect(otherModeTheme('dark')).toBe(DEFAULT_LIGHT);
  });
});
