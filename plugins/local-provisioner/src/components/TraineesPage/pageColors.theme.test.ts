import { buildThemeCss, PALETTES, THEME_IDS } from '@stratpoint/theme-utils';
// eslint-disable-next-line no-restricted-imports
import fs from 'fs';
// eslint-disable-next-line no-restricted-imports
import path from 'path';

/**
 * The Trainees page takes every colour from the app's theme variables (the lab report was unreadable in dark mode once because it did
 * not). This pins that: the stylesheet has no hex colour, and the text colours it uses are readable (4.5:1, the rule the palettes
 * themselves are held to) on every background it puts them on, in all 8 themes.
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

const css = buildThemeCss(PALETTES, THEME_IDS);
function vars(id: string): Record<string, string> {
  const block = new RegExp(`html\\.tv-${id}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
  return Object.fromEntries([...block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
}

describe('the Trainees page colours', () => {
  it('uses theme variables only: no hex or rgb colour in its stylesheet', () => {
    const source = fs.readFileSync(path.join(__dirname, 'pageStyles.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/\brgba?\(/);
    expect(source).not.toMatch(/\bhsla?\(/);
  });

  it('text and grey text are readable on the card, on a hovered or open row, and on the stat tiles, in every theme', () => {
    expect(THEME_IDS.length).toBeGreaterThanOrEqual(8);
    const backgrounds: Record<string, string> = {
      card: '--surface',
      'hovered or open row and stat tile': '--ds-gray-100',
    };
    for (const id of THEME_IDS) {
      const v = vars(id);
      expect(v['--surface']).toBeDefined(); // the parser found the theme
      for (const [where, token] of Object.entries(backgrounds)) {
        for (const text of ['--fg-primary', '--fg-secondary']) {
          const ratio = contrast(v[text], v[token]);
          // eslint-disable-next-line jest/no-conditional-expect
          if (ratio < 4.5) throw new Error(`${PALETTES[id].name}: ${text} ${v[text]} on the ${where} ${v[token]} is ${ratio.toFixed(2)}:1, under 4.5:1`);
        }
      }
    }
  });

  it('no tab of the page has a background colour: tabs are the plain underline tabs of the other pages', () => {
    for (const file of ['TraineesPage.tsx', 'TraineePanel.tsx']) {
      const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
      const tabs = [...source.matchAll(/<Tabs[\s\S]*?<\/Tabs>/g)].map(m => m[0]);
      expect(tabs.length).toBeGreaterThan(0);
      for (const block of tabs) expect(block).not.toMatch(/background|bgcolor|backgroundColor/i);
    }
    const styles = fs.readFileSync(path.join(__dirname, 'pageStyles.ts'), 'utf8');
    expect(styles).not.toMatch(/MuiTab|\.Mui-selected/);
  });
});
