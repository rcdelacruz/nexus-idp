// The portal's colour palettes: one object per theme the user can pick in Settings → Appearance.
//
// This file is data only (no imports) on purpose: `packages/app/scripts/generate-theme-css.mjs` reads it with
// plain Node to write the CSS variables, and `index.ts` reads it for `useColors()`. To add a theme:
//   1. add a palette here and its id to THEME_IDS,
//   2. register it in packages/app/src/App.tsx (one line),
//   3. run `yarn workspace app themes:css`.
// `palettes.test.ts` fails the build if a new palette has unreadable text or the generated CSS is stale.

export type ThemeId =
  | 'light'
  | 'light-classic'
  | 'dark'
  | 'dark-softer'
  | 'dark-midnight'
  | 'dark-warm'
  | 'dark-contrast'
  | 'dark-classic';

export interface Palette {
  /** Shown in Settings → Appearance. */
  name: string;
  isDark: boolean;
  /** The palette whose colours the sidebar wears (the sidebar is always a dark surface). */
  sidebar: ThemeId;
  /** Palettes kept exactly as they were before the softer themes: exempt from the contrast rule. */
  legacy?: boolean;
  // Backgrounds
  bg: string;
  surfaceSubtle: string;
  surface: string;
  avatarBg: string;
  inputBg: string;
  hoverBg: string;
  // Borders
  border: string;
  borderSubtle: string;
  borderHover: string;
  // Text
  text: string;
  textSecondary: string;
  textMuted: string;
  textDisabled: string;
  // Accent
  blue: string;
  progressTrack: string;
  /** Hover colour of the solid (contained) button; derived from `text` unless a classic theme pins it. */
  buttonHover?: string;
  /** CSS variables that cannot be derived from the colours above (kept exactly for the classic themes). */
  css?: Record<string, string>;
}

export const PALETTES: Record<ThemeId, Palette> = {
  light: {
    name: 'Light',
    isDark: false,
    sidebar: 'dark',
    bg: '#f1efe9',
    surfaceSubtle: '#ebe9e2',
    surface: '#f8f7f3',
    avatarBg: '#ece9e2',
    inputBg: '#fdfcfa',
    hoverBg: '#e6e3dc',
    border: '#d6d2c7',
    borderSubtle: '#e1ded5',
    borderHover: '#b9b4a7',
    text: '#1f1d1a',
    textSecondary: '#4f4b45',
    textMuted: '#68635b',
    textDisabled: '#a39e94',
    blue: '#0b5fcc',
    progressTrack: '#e1ded5',
  },
  'light-classic': {
    name: 'Light · classic',
    isDark: false,
    sidebar: 'dark-classic',
    legacy: true,
    bg: '#fafafa',
    surfaceSubtle: '#f5f5f5',
    surface: '#ffffff',
    avatarBg: '#f2f2f2',
    inputBg: '#ffffff',
    hoverBg: '#ebebeb',
    border: '#e5e5e5',
    borderSubtle: '#ebebeb',
    borderHover: '#c9c9c9',
    text: '#171717',
    textSecondary: '#4d4d4d',
    textMuted: '#8f8f8f',
    textDisabled: '#c9c9c9',
    blue: '#0070f3',
    progressTrack: '#ebebeb',
    buttonHover: '#383838',
    css: {
      '--blue-dark': '#0060df',
      '--border': '#ebebeb',
      '--bui-bg-neutral-1-pressed': '#e9e9e9',
      '--bui-bg-neutral-2-pressed': '#e2e2e2',
      '--bui-bg-neutral-3-hover': '#e2e2e2',
      '--bui-bg-neutral-3-pressed': '#d5d5d5',
      '--bui-bg-neutral-4': '#ebebeb',
      '--bui-bg-neutral-4-hover': '#e2e2e2',
      '--bui-bg-solid-hover': '#383838',
      '--bui-bg-solid-pressed': '#0a0a0a',
      '--bui-border-1': '#ebebeb',
      '--bui-scrollbar': 'rgba(200,200,200,0.5)',
      '--ds-gray-300': '#e2e2e2',
      '--ds-gray-400': '#ebebeb',
      '--ds-gray-600': '#878787',
    },
  },
  dark: {
    name: 'Dark',
    isDark: true,
    sidebar: 'dark',
    bg: '#141416',
    surfaceSubtle: '#18181b',
    surface: '#1b1b1e',
    avatarBg: '#232327',
    inputBg: '#232327',
    hoverBg: '#2a2a2f',
    border: '#34343a',
    borderSubtle: '#28282d',
    borderHover: '#4a4a52',
    text: '#e4e4e7',
    textSecondary: '#a8a8b0',
    textMuted: '#92929c',
    textDisabled: '#5a5a63',
    blue: '#3291ff',
    progressTrack: '#34343a',
  },
  'dark-softer': {
    name: 'Dark · softer',
    isDark: true,
    sidebar: 'dark-softer',
    bg: '#1c1c21',
    surfaceSubtle: '#202026',
    surface: '#232329',
    avatarBg: '#2b2b32',
    inputBg: '#2b2b32',
    hoverBg: '#33333b',
    border: '#3d3d45',
    borderSubtle: '#32323a',
    borderHover: '#54545e',
    text: '#e0e0e5',
    textSecondary: '#adadb6',
    textMuted: '#9d9da7',
    textDisabled: '#62626c',
    blue: '#58a3ff',
    progressTrack: '#3d3d45',
  },
  'dark-midnight': {
    name: 'Dark · midnight',
    isDark: true,
    sidebar: 'dark-midnight',
    bg: '#12151c',
    surfaceSubtle: '#151922',
    surface: '#181c25',
    avatarBg: '#202530',
    inputBg: '#202530',
    hoverBg: '#272d3a',
    border: '#313847',
    borderSubtle: '#252b38',
    borderHover: '#48516a',
    text: '#e2e6ee',
    textSecondary: '#a7afc0',
    textMuted: '#8f98ad',
    textDisabled: '#596176',
    blue: '#5aa2ff',
    progressTrack: '#313847',
  },
  'dark-warm': {
    name: 'Dark · warm',
    isDark: true,
    sidebar: 'dark-warm',
    bg: '#171513',
    surfaceSubtle: '#1a1816',
    surface: '#1e1c19',
    avatarBg: '#282520',
    inputBg: '#282520',
    hoverBg: '#302d27',
    border: '#3b3731',
    borderSubtle: '#2d2a25',
    borderHover: '#544f46',
    text: '#e8e4dc',
    textSecondary: '#b0aa9e',
    textMuted: '#99938a',
    textDisabled: '#655f55',
    blue: '#6aa8f5',
    progressTrack: '#3b3731',
  },
  'dark-contrast': {
    name: 'Dark · high contrast',
    isDark: true,
    sidebar: 'dark-contrast',
    bg: '#000000',
    surfaceSubtle: '#050505',
    surface: '#0a0a0a',
    avatarBg: '#141414',
    inputBg: '#141414',
    hoverBg: '#1f1f1f',
    border: '#7a7a7a',
    borderSubtle: '#4d4d4d',
    borderHover: '#a8a8a8',
    text: '#ffffff',
    textSecondary: '#d6d6d6',
    textMuted: '#b8b8b8',
    textDisabled: '#8a8a8a',
    blue: '#6cb2ff',
    progressTrack: '#4d4d4d',
  },
  'dark-classic': {
    name: 'Dark · classic',
    isDark: true,
    sidebar: 'dark-classic',
    legacy: true,
    bg: '#000000',
    surfaceSubtle: '#050505',
    surface: '#0a0a0a',
    avatarBg: '#1a1a1a',
    inputBg: '#1a1a1a',
    hoverBg: '#1f1f1f',
    border: '#2e2e2e',
    borderSubtle: '#1e1e1e',
    borderHover: '#454545',
    text: '#ededed',
    textSecondary: '#a1a1a1',
    textMuted: '#878787',
    textDisabled: '#454545',
    blue: '#3291ff',
    progressTrack: '#2e2e2e',
    buttonHover: '#d4d4d4',
    css: { '--bui-bg-solid-pressed': '#d4d4d4', '--ds-gray-300': '#292929', '--ds-gray-700': '#8f8f8f' },
  },
};

/** Order of the choices in Settings → Appearance. */
export const THEME_IDS: ThemeId[] = ['light', 'light-classic', 'dark', 'dark-softer', 'dark-midnight', 'dark-warm', 'dark-contrast', 'dark-classic'];

/** What "Dark" and "Light" mean when nothing more specific is known. */
export const DEFAULT_DARK: ThemeId = 'dark';
export const DEFAULT_LIGHT: ThemeId = 'light';

export function isThemeId(id: unknown): id is ThemeId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(PALETTES, id);
}

/** Is this theme a dark one? Unknown ids (a stale saved choice) count as light. */
export function themeIsDark(id: string | undefined | null): boolean {
  return isThemeId(id) ? PALETTES[id].isDark : false;
}
