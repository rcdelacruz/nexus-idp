// The test reads the committed themes.generated.css to prove it matches the palettes (Node-only, test-only).
// eslint-disable-next-line no-restricted-imports
import fs from 'fs';
// eslint-disable-next-line no-restricted-imports
import path from 'path';
import { PALETTES, THEME_IDS, buildThemeCss, isThemeId, themeIsDark } from '@stratpoint/theme-utils';
import { nexusThemes } from '../../theme';

const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('theme palettes', () => {
  it('lists every palette once, and Settings shows them in that order', () => {
    expect([...THEME_IDS].sort()).toEqual(Object.keys(PALETTES).sort());
    expect(new Set(THEME_IDS).size).toBe(THEME_IDS.length);
    for (const id of THEME_IDS) expect(PALETTES[PALETTES[id].sidebar].isDark).toBe(true); // the sidebar is always dark
  });

  it('keeps Dark and Light as the soft themes (everyone already on dark/light gets them)', () => {
    expect(PALETTES.dark).toMatchObject({ isDark: true, bg: '#141416' });
    expect(PALETTES.light).toMatchObject({ isDark: false, bg: '#f1efe9' });
    expect(PALETTES['dark-classic'].bg).toBe('#000000');
    expect(PALETTES['light-classic'].bg).toBe('#fafafa');
    expect(isThemeId('dark-softer')).toBe(true);
    expect(isThemeId('constructor')).toBe(false);
    expect(themeIsDark('dark-warm')).toBe(true);
    expect(themeIsDark('light-classic')).toBe(false);
    expect(themeIsDark('something-saved-long-ago')).toBe(false);
  });

  // Every text and accent colour must stay readable (WCAG AA, 4.5:1) on every surface it sits on.
  // The two classic palettes are the old Geist values, kept exactly as they were.
  describe.each(THEME_IDS.filter(id => !PALETTES[id].legacy))('%s', id => {
    const p = PALETTES[id];
    const surfaces = { page: p.bg, card: p.surface, raised: p.avatarBg, input: p.inputBg, hover: p.hoverBg } as const;
    const levels = { text: p.text, 'secondary text': p.textSecondary, 'muted text': p.textMuted, link: p.blue } as const;
    it.each(Object.entries(levels).flatMap(([lv, fg]) => Object.entries(surfaces).map(([sf, bg]) => [lv, sf, fg, bg] as const)))(
      '%s on the %s is at least 4.5:1',
      (_lv, _sf, fg, bg) => {
        expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
      },
    );
  });
});

describe('generated CSS', () => {
  it('is up to date (run `yarn workspace app themes:css`)', () => {
    const committed = fs.readFileSync(path.join(__dirname, 'themes.generated.css'), 'utf8');
    expect(committed).toBe(buildThemeCss(PALETTES, THEME_IDS));
  });

  it('gives the classic themes exactly the colours they had before', () => {
    const css = fs.readFileSync(path.join(__dirname, 'themes.generated.css'), 'utf8');
    const block = (sel: string) => css.slice(css.indexOf(`${sel} {`), css.indexOf('}', css.indexOf(`${sel} {`)));
    expect(block('html.tv-dark-classic')).toContain('--bui-bg-app: #000000;');
    expect(block('html.tv-dark-classic')).toContain('--border: #2e2e2e;');
    expect(block('html.tv-light-classic')).toContain('--bui-bg-app: #fafafa;');
    expect(block('html.tv-light-classic')).toContain('--border: #ebebeb;');
    expect(css).toMatch(/html,\nhtml\.tv-light \{/); // bare <html>, before React loads, is the default light theme
  });
});

describe('MUI themes', () => {
  it.each(THEME_IDS)('%s carries its id and its palette', id => {
    const t = nexusThemes[id].getTheme('v4' as any) as any;
    expect(t.palette.nexusTheme).toBe(id);
    expect(t.palette.type).toBe(PALETTES[id].isDark ? 'dark' : 'light');
    expect(t.palette.background.default).toBe(PALETTES[id].bg);
    expect(t.palette.text.primary).toBe(PALETTES[id].text);
    expect(t.palette.navigation.background).toBe(PALETTES[PALETTES[id].sidebar].bg);
  });

  it('keeps the classic themes\' solid button exactly as it was (colour, text, hover)', () => {
    const solid = (id: 'dark-classic' | 'light-classic') =>
      (nexusThemes[id].getTheme('v4' as any) as any).overrides.MuiButton.containedPrimary;
    expect(solid('dark-classic')).toMatchObject({ backgroundColor: '#ededed', color: '#000000', '&:hover': { backgroundColor: '#d4d4d4' } });
    expect(solid('light-classic')).toMatchObject({ backgroundColor: '#171717', color: '#ffffff', '&:hover': { backgroundColor: '#383838' } });
  });
});
