// eslint-disable-next-line no-restricted-imports
import fs from 'fs';
// eslint-disable-next-line no-restricted-imports
import path from 'path';

/**
 * Ronald: "make the toast message background less transparent". A toast is an Alert inside a Snackbar and floats over the page. The
 * in-page banners are a 6% tint (they sit on the page's own background), which let the page show through a toast. For a toast the tint
 * has to lie on the opaque surface colour: the last background layer is `var(--surface)`, never a bare translucent colour.
 */
const css = fs.readFileSync(path.join(__dirname, 'overrides.css'), 'utf8');

const blockOf = (selector: string): string => {
  const start = css.indexOf(`${selector} {`);
  return start < 0 ? '' : css.slice(start, css.indexOf('}', start) + 1);
};

describe('toasts are not see-through', () => {
  for (const severity of ['Warning', 'Error', 'Info', 'Success']) {
    it(`a ${severity.toLowerCase()} toast has its tint on the opaque surface colour`, () => {
      const block = blockOf(`[class*="MuiSnackbar-root"] [class*="MuiAlert-standard${severity}"]`);
      expect(block).not.toBe('');
      const background = /background:\s*([^;]+);/.exec(block)?.[1] ?? '';
      expect(background).toMatch(/,\s*var\(--surface\)\s*!important$/); // the last layer is solid
      expect(background).toMatch(/linear-gradient\(rgba\([^)]*\),\s*rgba\([^)]*\)\)/); // the tint on top
      // The tint is strong enough to read as that severity (the banner's 0.06 is not).
      expect(Number(/rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\)/.exec(background)?.[1])).toBeGreaterThanOrEqual(0.1);
    });
  }

  it('the toast floats like a menu: it has a shadow, lighter on the light themes', () => {
    expect(blockOf('[class*="MuiSnackbar-root"] [class*="MuiAlert-root"]')).toMatch(/box-shadow:/);
    expect(css).toMatch(/html\.theme-light \[class\*="MuiSnackbar-root"\] \[class\*="MuiAlert-root"\]/);
  });

  it('the banners in the page keep their plain tint (only toasts changed)', () => {
    expect(blockOf('[class*="MuiAlert-standardWarning"]')).toMatch(/background:\s*rgba\(245, 166, 35, 0\.06\)/);
  });
});
