import React from 'react';
import { useTheme } from '@material-ui/core/styles';

// ── Vercel Geist design tokens — exact values from https://vercel.com/geist/introduction
// Single source of truth. Never duplicate these in plugin files.

const DARK = {
  // Backgrounds
  bg:            '#000000',  // --ds-background-200
  surfaceSubtle: '#050505',  // between bg and surface — subtle elevation
  surface:       '#0a0a0a',  // --ds-background-100
  avatarBg:      '#1a1a1a',  // --ds-gray-100
  inputBg:       '#1a1a1a',  // --ds-gray-100
  hoverBg:       '#1f1f1f',  // --ds-gray-200
  // Borders
  border:        '#2e2e2e',  // --ds-gray-400 / --border
  borderHover:   '#454545',  // --ds-gray-500 / --border-hover
  // Text
  text:          '#ededed',  // --fg-primary
  textSecondary: '#a1a1a1',  // --fg-secondary
  textMuted:     '#878787',  // --fg-tertiary
  textDisabled:  '#454545',  // --ds-gray-500
  // Accent
  blue:          '#3291ff',
  progressTrack: '#2e2e2e',
};

const LIGHT = {
  // Backgrounds
  bg:            '#fafafa',  // --ds-background-200
  surfaceSubtle: '#f5f5f5',  // between bg and surface — subtle elevation
  surface:       '#ffffff',  // --ds-background-100
  avatarBg:      '#f2f2f2',  // --ds-gray-100
  inputBg:       '#ffffff',  // --ds-background-100
  hoverBg:       '#ebebeb',  // --ds-gray-200
  // Borders
  border:        '#ebebeb',  // --border
  borderHover:   '#c9c9c9',  // --border-hover
  // Text
  text:          '#171717',  // --fg-primary
  textSecondary: '#4d4d4d',  // --fg-secondary
  textMuted:     '#8f8f8f',  // --fg-tertiary
  textDisabled:  '#c9c9c9',
  // Accent
  blue:          '#0070f3',
  progressTrack: '#ebebeb',
};

// ── Semantic colors — same in both modes (status/state colors)
export const semantic = {
  success:        '#22c55e',
  successBg:      '#14532d',
  successBgHover: '#1a3d1a',
  error:          '#e53935',
  errorBg:        '#3b0e0e',
  warning:        '#fb8c00',
  warningBg:      '#1a0f00',
  warningBorder:  '#854d0e',
  warningText:    '#a16207',
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

export type DesignTokens = typeof DARK & { isDark: boolean };

export function useColors(): DesignTokens {
  const theme = useTheme();
  const isDark = theme.palette.type === 'dark';
  return { ...(isDark ? DARK : LIGHT), isDark };
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

  // Solid color variants — dark bg, white text
  const SOLID: Record<string, React.CSSProperties> = {
    blue:    { background: 'var(--ds-blue-800)',   color: 'var(--ds-contrast-fg, #fff)' },
    purple:  { background: 'var(--ds-purple-900)', color: 'var(--ds-contrast-fg, #fff)' },
    amber:   { background: 'var(--ds-amber-700)',  color: '#000' },
    red:     { background: 'var(--ds-red-900)',    color: 'var(--ds-contrast-fg, #fff)' },
    green:   { background: 'var(--ds-green-900)',  color: 'var(--ds-contrast-fg, #fff)' },
    teal:    { background: 'var(--ds-teal-900)',   color: 'var(--ds-contrast-fg, #fff)' },
    pink:    { background: 'var(--ds-pink-900)',   color: 'var(--ds-contrast-fg, #fff)' },
    gray:    { background: 'var(--ds-gray-900)',   color: 'var(--ds-contrast-fg, #fff)' },
    inverted:{ background: 'var(--ds-gray-1000)',  color: 'var(--ds-gray-100)' },
  };

  // Subtle variants — light tinted bg, dark colored text
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
