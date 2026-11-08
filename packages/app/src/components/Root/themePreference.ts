import { useEffect, useState } from 'react';
import { appThemeApiRef, useApi } from '@backstage/core-plugin-api';
import { DEFAULT_DARK, DEFAULT_LIGHT, isThemeId, themeIsDark } from '@stratpoint/theme-utils';
import type { ThemeId } from '@stratpoint/theme-utils';

/**
 * The theme actually in use for what is saved. Backstage's "Auto" (nothing saved) and a saved id that no longer
 * exists both follow the device, exactly like Backstage's own AppThemeProvider: the first light or dark theme.
 */
export function resolveThemeId(saved: string | undefined | null, prefersDark: boolean): ThemeId {
  if (isThemeId(saved)) return saved;
  return prefersDark ? DEFAULT_DARK : DEFAULT_LIGHT;
}

/** Does the device ask for a dark appearance right now? Follows changes while the page is open. */
export function usePrefersDark(): boolean {
  const query = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : undefined;
  const [prefersDark, setPrefersDark] = useState(Boolean(query?.matches));
  useEffect(() => {
    if (!query) return undefined;
    const onChange = (e: { matches: boolean }) => setPrefersDark(e.matches);
    setPrefersDark(query.matches);
    if (query.addEventListener) {
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    }
    query.addListener(onChange);
    return () => query.removeListener(onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return prefersDark;
}

/** The id of the theme in use right now (Auto resolved), kept up to date as the user changes it. */
export function useActiveThemeId(): ThemeId {
  const appThemeApi = useApi(appThemeApiRef);
  const prefersDark = usePrefersDark();
  const [saved, setSaved] = useState(() => appThemeApi.getActiveThemeId());
  useEffect(() => {
    const subscription = appThemeApi.activeThemeId$().subscribe(id => setSaved(id));
    return () => subscription.unsubscribe();
  }, [appThemeApi]);
  return resolveThemeId(saved, prefersDark);
}

// The sidebar's sun/moon button (and Ctrl+T) flips between light and dark. With several of each, it returns to the
// light and the dark theme the user chose last, remembered per browser.
const storageKey = (dark: boolean) => (dark ? 'nexus:last-dark-theme' : 'nexus:last-light-theme');

export function rememberTheme(id: string | undefined | null) {
  if (!isThemeId(id)) return;
  try {
    window.localStorage.setItem(storageKey(themeIsDark(id)), id);
  } catch {
    // storage blocked: the button falls back to the default theme of the other mode
  }
}

/** The theme the toggle switches to from `current`: the last one used in the other mode. */
export function otherModeTheme(current: string | undefined | null): ThemeId {
  const wantDark = !themeIsDark(current);
  try {
    const saved = window.localStorage.getItem(storageKey(wantDark));
    if (isThemeId(saved) && themeIsDark(saved) === wantDark) return saved;
  } catch {
    // ignore
  }
  return wantDark ? DEFAULT_DARK : DEFAULT_LIGHT;
}
