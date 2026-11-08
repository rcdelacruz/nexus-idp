import React from 'react';
import { useTheme } from '@material-ui/core/styles';

// ── Design tokens. The palettes (one per theme in Settings → Appearance) live in ./palettes.ts: the single source.
// Never duplicate their values in plugin files; take them from useColors().
import { PALETTES, DEFAULT_DARK, DEFAULT_LIGHT, isThemeId } from './palettes';
import type { Palette, ThemeId } from './palettes';

export { PALETTES, THEME_IDS, DEFAULT_DARK, DEFAULT_LIGHT, isThemeId, themeIsDark } from './palettes';
export type { Palette, ThemeId } from './palettes';
export { buildThemeCss } from './themeCss';

function tokensOf(p: Palette) {
  return {
    bg: p.bg,
    surfaceSubtle: p.surfaceSubtle,
    surface: p.surface,
    avatarBg: p.avatarBg,
    inputBg: p.inputBg,
    hoverBg: p.hoverBg,
    border: p.border,
    borderSubtle: p.borderSubtle,
    borderHover: p.borderHover,
    text: p.text,
    textSecondary: p.textSecondary,
    textMuted: p.textMuted,
    textDisabled: p.textDisabled,
    blue: p.blue,
    progressTrack: p.progressTrack,
  };
}

// ── Semantic colors — same in both modes (status/state colors)
export const semantic = {
  success:        '#22c55e',
  successBg:      '#14532d',
  successBgHover: '#1a3d1a',
  error:          '#e53935',
  errorBg:        '#3b0e0e',
  warning:           '#fb8c00',
  warningBg:         '#1a0f00',   // dark mode
  warningBgLight:    '#fffbeb',   // light mode
  warningBorder:     '#854d0e',   // dark mode
  warningBorderLight:'#d97706',   // light mode
  warningText:       '#a16207',   // dark mode
  warningTextLight:  '#92400e',   // light mode
  info:           '#38bdf8',
  infoBg:         '#0c4a6e',
  purple:         '#a855f7',
  purpleBg:       '#2e1065',
  // Completion / teal — mode-specific: use `completed` in dark, `completedLight` in light
  completed:      '#50e3c2',  // dark mode
  completedLight: '#079669',  // light mode
} as const;

// ── Spacing scale (Geist 4-point grid)
export const spacing = {
  0:  '0px',
  1:  '4px',
  2:  '8px',
  3:  '12px',
  4:  '16px',
  5:  '20px',
  6:  '24px',
  8:  '32px',
  10: '40px',
  12: '48px',
  16: '64px',
} as const;

// ── Border radius scale (Geist)
export const borderRadius = {
  none:   '0px',
  sm:     '4px',
  md:     '6px',
  lg:     '8px',
  xl:     '12px',
  '2xl':  '16px',
  full:   '9999px',
} as const;

export type DesignTokens = ReturnType<typeof tokensOf> & { isDark: boolean; themeId: ThemeId };

/** The theme id the app's MUI theme was built for (set by createNexusTheme in packages/app). */
function themeIdOf(palette: unknown): ThemeId | undefined {
  const id = (palette as { nexusTheme?: unknown } | undefined)?.nexusTheme;
  return isThemeId(id) ? id : undefined;
}

export function useColors(): DesignTokens {
  const theme = useTheme();
  const isDark = theme.palette.type === 'dark';
  const themeId = themeIdOf(theme.palette) ?? (isDark ? DEFAULT_DARK : DEFAULT_LIGHT);
  const palette = PALETTES[themeId];
  return { ...tokensOf(palette), isDark: palette.isDark, themeId };
}

/** Non-hook version — safe to call outside React tree (e.g. root.render) */
export function getColors(isDark: boolean, id?: ThemeId): DesignTokens {
  const themeId = id ?? (isDark ? DEFAULT_DARK : DEFAULT_LIGHT);
  const palette = PALETTES[themeId];
  return { ...tokensOf(palette), isDark: palette.isDark, themeId };
}

// Geist Badge — exact spec sourced from vercel.com badge CSS.
// Variants: 'blue' | 'blue-subtle' | 'purple' | 'purple-subtle' | 'amber' | 'amber-subtle' |
//           'red' | 'red-subtle' | 'green' | 'green-subtle' | 'teal' | 'teal-subtle' |
//           'pink' | 'pink-subtle' | 'gray' | 'gray-subtle' | 'inverted'
//
// Solid  (e.g. 'blue'):        --ds-{color}-800/900 bg, --ds-contrast-fg (white) text
// Subtle (e.g. 'blue-subtle'): --ds-{color}-200 bg, --ds-{color}-900 text
// Shape: pill (border-radius: 9999px), height: 22px, padding: 0 8px, no border
export function badge(variant: string): React.CSSProperties {
  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: 22,
    padding: '0 8px',
    borderRadius: 9999,
    fontSize: 12,
    fontWeight: 500,
    whiteSpace: 'nowrap',
    flexShrink: 0,
    border: 'none',
    fontVariantNumeric: 'tabular-nums',
  };

  // Solid color variants — tinted bg with bright colored text
  // Uses -200 bg (deep tint in dark, pastel in light) + -900 text (bright in dark, dark in light)
  // Same visual weight as subtle but with stronger color presence
  const SOLID: Record<string, React.CSSProperties> = {
    blue:    { background: 'var(--ds-blue-200)',   color: 'var(--ds-blue-900)' },
    purple:  { background: 'var(--ds-purple-200)', color: 'var(--ds-purple-900)' },
    amber:   { background: 'var(--ds-amber-200)',  color: 'var(--ds-amber-900)' },
    red:     { background: 'var(--ds-red-200)',    color: 'var(--ds-red-900)' },
    green:   { background: 'var(--ds-green-200)',  color: 'var(--ds-green-900)' },
    teal:    { background: 'var(--ds-teal-200)',   color: 'var(--ds-teal-900)' },
    pink:    { background: 'var(--ds-pink-200)',   color: 'var(--ds-pink-900)' },
    gray:    { background: 'var(--ds-gray-200)',   color: 'var(--ds-gray-1000)' },
    inverted:{ background: 'var(--ds-gray-1000)',  color: 'var(--ds-gray-100)' },
  };

  // Subtle variants — tinted bg, colored text
  // -200 bg adapts per mode (light=pastel, dark=deep tint), -900 text adapts (light=dark, dark=bright)
  const SUBTLE: Record<string, React.CSSProperties> = {
    blue:    { background: 'var(--ds-blue-200)',   color: 'var(--ds-blue-900)' },
    purple:  { background: 'var(--ds-purple-200)', color: 'var(--ds-purple-900)' },
    amber:   { background: 'var(--ds-amber-200)',  color: 'var(--ds-amber-900)' },
    red:     { background: 'var(--ds-red-200)',    color: 'var(--ds-red-900)' },
    green:   { background: 'var(--ds-green-200)',  color: 'var(--ds-green-900)' },
    teal:    { background: 'var(--ds-teal-300)',   color: 'var(--ds-teal-900)' },
    pink:    { background: 'var(--ds-pink-300)',   color: 'var(--ds-pink-900)' },
    gray:    { background: 'var(--ds-gray-200)',   color: 'var(--ds-gray-1000)' },
  };

  const isSubtle = variant.endsWith('-subtle');
  const color = isSubtle ? variant.replace('-subtle', '') : variant;
  const colors = isSubtle ? SUBTLE[color] : SOLID[color];

  return { ...base, ...(colors ?? SUBTLE.gray) };
}

// Legacy chipStyle — kept for existing usages, wraps badge() with explicit colors.
// Prefer badge() for new code.
export function chipStyle(color: string, bg: string, border?: string) {
  return {
    display: 'inline-flex' as const,
    alignItems: 'center' as const,
    padding: '2px 8px',
    borderRadius: 4,
    fontSize: '0.6875rem' as const,
    fontWeight: 500,
    letterSpacing: '0.01em',
    color,
    background: bg,
    border: `1px solid ${border ?? bg}`,
    whiteSpace: 'nowrap' as const,
  };
}
