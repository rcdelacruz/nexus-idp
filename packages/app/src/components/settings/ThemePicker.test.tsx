import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { TestApiProvider } from '@backstage/test-utils';
import { AppThemeSelector } from '@backstage/core-app-api';
import { appThemeApiRef } from '@backstage/core-plugin-api';
import { PALETTES, THEME_IDS } from '@stratpoint/theme-utils';
import { ThemePicker } from './ThemePicker';

const themes = THEME_IDS.map(id => ({ id, title: PALETTES[id].name, variant: PALETTES[id].isDark ? 'dark' : 'light', Provider: () => null })) as any[];

const setup = (saved?: string) => {
  const selector = new AppThemeSelector(themes);
  selector.setActiveThemeId(saved);
  const spy = jest.spyOn(selector, 'setActiveThemeId');
  render(
    <TestApiProvider apis={[[appThemeApiRef, selector]]}>
      <ThemePicker />
    </TestApiProvider>,
  );
  return { selector, spy };
};

const checked = () => screen.getAllByRole('radio').filter(r => (r as HTMLInputElement).checked).map(r => (r as HTMLInputElement).value);
// jsdom normalises colours to rgb(), so compare through a probe element
const css = (color: string) => {
  const probe = document.createElement('div');
  probe.style.background = color;
  return probe.style.background;
};

describe('theme picker (Settings → Appearance)', () => {
  it('shows Auto and all 8 themes, grouped Automatic / Light / Dark, in the registered order', () => {
    setup('dark');
    expect(screen.getAllByRole('radio').map(r => (r as HTMLInputElement).value)).toEqual(['auto', ...THEME_IDS]);
    const names = (group: string) => within(screen.getByRole('group', { name: group })).getAllByRole('radio').map(r => (r as HTMLInputElement).value);
    expect(names('Automatic')).toEqual(['auto']);
    expect(names('Light')).toEqual(['light', 'light-classic']);
    expect(names('Dark')).toEqual(['dark', 'dark-softer', 'dark-midnight', 'dark-warm', 'dark-contrast', 'dark-classic']);
  });

  it('labels each choice with its name, and marks only the two defaults', () => {
    setup('dark');
    const optionOf = (name: string) => screen.getByText(name, { selector: 'span' }).closest('label') as HTMLElement;
    for (const id of THEME_IDS) expect(optionOf(PALETTES[id].name).querySelector('input')!.value).toBe(id);
    expect(optionOf('Auto').querySelector('input')!.value).toBe('auto');
    expect(screen.getAllByText('Default')).toHaveLength(2);
    expect(within(optionOf('Light')).getByText('Default')).toBeTruthy();
    expect(within(optionOf('Dark')).getByText('Default')).toBeTruthy();
    expect(within(optionOf('Auto')).getByText('Follows your device')).toBeTruthy();
  });

  it('selects the saved theme, and only that one', () => {
    setup('dark-midnight');
    expect(checked()).toEqual(['dark-midnight']);
  });

  it('selects Auto when nothing is saved, and when the saved theme no longer exists', () => {
    setup(undefined);
    expect(checked()).toEqual(['auto']);
  });

  it.each(['a-theme-removed-long-ago', 'constructor', '__proto__'])('treats a saved id that is not a theme (%s) as Auto', saved => {
    setup(saved);
    expect(checked()).toEqual(['auto']);
  });

  it('switches the theme when a card is chosen, and Auto clears the saved choice', () => {
    const { spy } = setup('dark');
    const radio = (value: string) => document.querySelector(`input[value="${value}"]`) as HTMLInputElement;
    fireEvent.click(radio('dark-warm'));
    expect(spy).toHaveBeenLastCalledWith('dark-warm');
    fireEvent.click(radio('light-classic'));
    expect(spy).toHaveBeenLastCalledWith('light-classic');
    fireEvent.click(radio('auto'));
    expect(spy).toHaveBeenLastCalledWith(undefined);
  });

  it('follows the theme when it is changed somewhere else (sidebar button, Ctrl+T)', async () => {
    const { selector } = setup('dark');
    await act(async () => {}); // Backstage delivers the first value on a microtask
    expect(checked()).toEqual(['dark']);
    await act(async () => selector.setActiveThemeId('light'));
    expect(checked()).toEqual(['light']);
    await act(async () => selector.setActiveThemeId(undefined));
    expect(checked()).toEqual(['auto']);
  });

  it.each(THEME_IDS)('%s: its picture is painted from that theme\'s own palette', id => {
    setup('dark');
    const preview = document.querySelector(`[data-theme-preview="${id}"]`) as HTMLElement;
    const p = PALETTES[id];
    expect(preview.style.background).toBe(css(p.bg));
    // the sidebar is always a dark surface; the card uses the theme's surface colour
    const html = preview.innerHTML;
    for (const colour of [PALETTES[p.sidebar].bg, p.surface, p.blue, p.text]) expect(html).toContain(css(colour));
  });

  it('draws Auto as the default light theme next to the default dark one', () => {
    setup('dark');
    const auto = document.querySelector('[data-theme-preview="auto"]') as HTMLElement;
    expect(auto.querySelector('[data-theme-preview="light"]')).toBeTruthy();
    expect(auto.querySelector('[data-theme-preview="dark"]')).toBeTruthy();
  });
});
