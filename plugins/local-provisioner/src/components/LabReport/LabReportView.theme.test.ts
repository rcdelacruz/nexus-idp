import { buildThemeCss, PALETTES, THEME_IDS } from '@stratpoint/theme-utils';
import { REPORT_CSS, reportHtmlDocument } from './LabReportView';
import { LabReport } from '../../api/labReport';

/**
 * The report was unreadable in dark mode because it used fixed light-theme colours (dark grey text on the dark dialog). These tests
 * resolve the report's real colours against every real palette of the portal, with the same WCAG contrast rule the palettes
 * themselves are held to (themes.test.ts: 4.5:1).
 */

const lum = (hex: string) => {
  const n = parseInt(hex.slice(1, 7), 16);
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

const generated = buildThemeCss(PALETTES, THEME_IDS);
/** The CSS variables the app sets on <html> for one theme (the same text the browser gets). */
function themeVars(id: string): Record<string, string> {
  const block = new RegExp(`html\\.tv-${id}\\s*\\{([^}]*)\\}`).exec(generated)?.[1] ?? '';
  return Object.fromEntries([...block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
}

/** `var(--x, fallback)` -> the theme's value of --x, or the fallback; anything else as it is. */
const resolve = (value: string, vars: Record<string, string>) => {
  const m = /^var\((--[a-z0-9-]+)\s*,\s*([^)]+)\)$/.exec(value.trim());
  return m ? (vars[m[1]] ?? m[2].trim()) : value.trim();
};

/** The report's own colour variables, as written in REPORT_CSS: the default set and the dark-mode override. */
function reportColors() {
  const base = Object.fromEntries([...(/^\.lr \{ (--lr-fg:[^}]*)\}/m.exec(REPORT_CSS)?.[1] ?? '').matchAll(/--lr-([a-z]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
  const darkBad = /html\.theme-dark \.lr \{ --lr-bad:\s*([^;]+);/.exec(REPORT_CSS)?.[1].trim();
  return { base, darkBad };
}

describe('the lab report colours', () => {
  const { base, darkBad } = reportColors();

  it('reads its colours from the app theme and has a darker-mode red', () => {
    expect(base).toMatchObject({ fg: 'var(--fg-primary, #1a1a1a)', muted: 'var(--fg-secondary, #555555)' });
    expect(base.head).toMatch(/^var\(--ds-gray-100,/);
    expect(darkBad).toBeDefined();
    expect(darkBad).not.toBe(base.bad);
  });

  it('every theme the portal has: text, grey text and the red are readable on the dialog and on the table header', () => {
    expect(THEME_IDS.length).toBeGreaterThanOrEqual(8);
    for (const id of THEME_IDS) {
      const vars = themeVars(id);
      expect(vars['--surface']).toBeDefined(); // the parser found this theme
      const dark = PALETTES[id].isDark;
      const colour = { fg: resolve(base.fg, vars), muted: resolve(base.muted, vars), bad: dark ? darkBad! : base.bad };
      const surfaces = { 'the dialog': vars['--surface'], 'the table header': resolve(base.head, vars) };
      for (const [surface, bg] of Object.entries(surfaces)) {
        for (const [name, fg] of Object.entries(colour)) {
          const ratio = contrast(fg, bg);
          // eslint-disable-next-line jest/no-conditional-expect
          if (ratio < 4.5) throw new Error(`${PALETTES[id].name}: report ${name} text ${fg} on ${surface} ${bg} is ${ratio.toFixed(2)}:1, under 4.5:1`);
        }
      }
    }
  });

  it('the report text is not the dark grey of the old light-only styling in a dark theme', () => {
    const vars = themeVars('dark');
    expect(resolve(base.fg, vars)).toBe(vars['--fg-primary']);
    expect(contrast(resolve(base.fg, vars), vars['--surface'])).toBeGreaterThan(7);
    expect(contrast('#1a1a1a', vars['--surface'])).toBeLessThan(2); // what it used to be: unreadable
  });

  it('a hard-coded colour cannot creep back in: outside the variable definitions the stylesheet uses none', () => {
    const rules = REPORT_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter(l => !/--lr-[a-z]+:/.test(l))
      .join('\n');
    expect(rules).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(rules).not.toMatch(/\b(rgb|rgba|hsl)\(/);
  });
});

describe('the downloaded report page', () => {
  const report = {
    version: 1,
    generatedAt: '2026-11-07T10:00:00Z',
    trainee: 'ann@example.com',
    course: 'nodejs-b',
    lab: 'lab-ann',
    environment: { state: 'running', lastChangeAt: '2026-11-07T09:00:00Z' },
    summary: ['s'],
    checks: [],
    history: [],
  } as unknown as LabReport;

  it('has no theme variables, so it uses its own black-on-white colours, on an explicit white page', () => {
    const html = reportHtmlDocument(report);
    expect(html).toContain('body { margin: 24px; background: #ffffff; }');
    const { base } = reportColors();
    const none: Record<string, string> = {};
    for (const key of ['fg', 'muted', 'bad'] as const) {
      expect(contrast(resolve(base[key], none), '#ffffff')).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(resolve(base.fg, none), resolve(base.head, none))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(resolve(base.muted, none), resolve(base.head, none))).toBeGreaterThanOrEqual(4.5);
  });
});
