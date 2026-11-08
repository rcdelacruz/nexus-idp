import React, { useState } from 'react';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderInTestApp } from '@backstage/test-utils';
import sample from './__fixtures__/vol34-sample.json';
import { NO_FILTERS, parseRadar } from './radarModel';
import { TechRadarView } from './TechRadarView';
import { RadarUrlState } from './useRadarUrlState';

const { radar } = parseRadar(sample, { volume: 34, label: 'Vol. 34 · April 2026' });

/** The view with its state held locally instead of in the URL. */
const Harness = ({ initial = {}, wide = true, stale = false }: { initial?: Partial<RadarUrlState>; wide?: boolean; stale?: boolean }) => {
  const [state, setState] = useState<RadarUrlState>({ filters: NO_FILTERS, view: 'radar', ...initial });
  return (
    <TechRadarView
      radar={radar}
      stale={stale}
      wide={wide}
      state={state}
      onChange={patch => setState(s => ({ ...s, ...patch, filters: { ...s.filters, ...patch.filters } }))}
    />
  );
};

const chart = () => document.querySelector('svg[aria-label^="Technology radar"]') as SVGSVGElement;
const shown = () => chart().querySelectorAll('[data-blip-id]:not([aria-hidden="true"])').length;
const dot = (name: RegExp) => screen.getByRole('button', { name });

describe('TechRadarView', () => {
  it('draws every technology with its name beside the dot (nothing to click to read it)', async () => {
    await renderInTestApp(<Harness />);
    expect(chart().querySelectorAll('[data-blip-id]')).toHaveLength(118);
    expect(shown()).toBe(118);
    const names = Array.from(chart().querySelectorAll('text')).map(t => t.textContent);
    expect(names).toContain('Passkeys ▲');
    expect(names).toContain('Zero trust architecture');
    expect(screen.getByText('118 of 118 technologies')).toBeInTheDocument();
  });

  it('shortens a very long name with an ellipsis on the chart, and keeps the full name in the accessible name', async () => {
    await renderInTestApp(<Harness />);
    const long = 'Coding throughput as a measure of productivity';
    expect(Array.from(chart().querySelectorAll('text')).some(t => t.textContent?.startsWith('Coding throughput') && t.textContent.endsWith('…'))).toBe(true);
    expect(dot(new RegExp(`^${long}, Techniques, Caution`))).toBeInTheDocument();
  });

  it('shows a hover card at once with the ring and quadrant', async () => {
    await renderInTestApp(<Harness />);
    fireEvent.mouseEnter(dot(/^Passkeys, Techniques, Adopt/));
    expect(within(chart()).getByText('Adopt · Techniques')).toBeInTheDocument();
    expect(within(chart()).getByText('Moved in (closer to adopting)')).toBeInTheDocument();
  });

  it('search narrows the radar: the other dots fade and leave the tab order', async () => {
    await renderInTestApp(<Harness />);
    fireEvent.change(screen.getByLabelText('Search technologies'), { target: { value: 'passkeys' } });
    expect(screen.getByText('1 of 118 technologies')).toBeInTheDocument();
    expect(shown()).toBe(1);
    expect(chart().querySelectorAll('[data-blip-id][aria-hidden="true"]')).toHaveLength(117);
    fireEvent.click(screen.getByRole('button', { name: /Clear filters/ }));
    expect(screen.getByText('118 of 118 technologies')).toBeInTheDocument();
  });

  it('filters by ring, quadrant and what changed', async () => {
    await renderInTestApp(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /^Adopt\s*17$/ }));
    expect(screen.getByText('17 of 118 technologies')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Adopt\s*17$/ }));
    fireEvent.click(screen.getByRole('button', { name: /^New\s*87$/ }));
    expect(screen.getByText('87 of 118 technologies')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Moved\s*18$/ }));
    expect(screen.getByText('18 of 118 technologies')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^All\s*118$/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Tools\s*32$/ }));
    expect(screen.getByText('32 of 118 technologies')).toBeInTheDocument();
  });

  it('opens a technology on click, and Escape closes it', async () => {
    await renderInTestApp(<Harness />);
    expect(screen.queryByRole('complementary')).toBeNull();
    fireEvent.click(dot(/^Passkeys, Techniques, Adopt/));
    const panel = screen.getByRole('complementary', { name: 'Details: Passkeys' });
    expect(within(panel).getByRole('heading', { name: 'Passkeys' })).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: /View on thoughtworks.com/ })).toHaveAttribute('href', 'https://www.thoughtworks.com/radar/techniques/passkeys');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('opens a technology from a shared link, and jumps between related technologies', async () => {
    const withRelated = radar.blips.find(b => b.related.length > 0)!;
    const related = radar.blips.find(b => b.id === withRelated.related[0])!;
    await renderInTestApp(<Harness initial={{ blip: withRelated.id }} />);
    const panel = screen.getByRole('complementary', { name: `Details: ${withRelated.name}` });
    fireEvent.click(within(panel).getByRole('button', { name: related.name }));
    expect(screen.getByRole('complementary', { name: `Details: ${related.name}` })).toBeInTheDocument();
  });

  it('magnifies a quadrant and returns to the whole radar', async () => {
    await renderInTestApp(<Harness />);
    expect(chart().getAttribute('viewBox')).toBe('0 0 800 800');
    fireEvent.click(screen.getByRole('button', { name: 'Magnify Techniques' }));
    expect(chart().getAttribute('viewBox')).toBe('400 0 400 400');
    fireEvent.click(screen.getByRole('button', { name: 'Show the whole radar' }));
    expect(chart().getAttribute('viewBox')).toBe('0 0 800 800');
  });

  it('keeps the same dot positions when magnifying (zooming only magnifies)', async () => {
    await renderInTestApp(<Harness />);
    const before = chart().querySelector('[data-blip-id="passkeys"] circle:nth-of-type(2)')!.getAttribute('cx');
    fireEvent.click(screen.getByRole('button', { name: 'Magnify Techniques' }));
    expect(chart().querySelector('[data-blip-id="passkeys"] circle:nth-of-type(2)')!.getAttribute('cx')).toBe(before);
  });

  it('opens a technology on the half of the radar away from its dot, so the dot is never covered', async () => {
    // Passkeys is in Techniques (right half); Zero-trust... use a Tools technology for the left half.
    await renderInTestApp(<Harness initial={{ blip: 'passkeys' }} />);
    const rightHalf = screen.getByRole('complementary').parentElement!;
    expect(rightHalf.style.left).toBe('0px');
    expect(rightHalf.style.right).toBe('');
  });

  it('opens a left-half technology with the panel on the right', async () => {
    const tool = radar.blips.find(b => b.quadrant === 'tools')!;
    await renderInTestApp(<Harness initial={{ blip: tool.id }} />);
    const panel = screen.getByRole('complementary').parentElement!;
    expect(panel.style.right).toBe('0px');
    expect(panel.style.left).toBe('');
  });

  it('when magnified, only that quadrant\'s title can be reached (the others are out of view)', async () => {
    await renderInTestApp(<Harness />);
    expect(screen.getAllByRole('button', { name: /^Magnify / })).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Magnify Techniques' }));
    expect(screen.queryAllByRole('button', { name: /^Magnify / })).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: 'Show the whole radar' })).toHaveLength(1);
  });

  it('Escape in the search box leaves the open technology alone, and Escape elsewhere closes it', async () => {
    await renderInTestApp(<Harness initial={{ blip: 'passkeys' }} />);
    fireEvent.keyDown(screen.getByLabelText('Search technologies'), { key: 'Escape' });
    expect(screen.getByRole('complementary')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('does not put focus back on a dot that a new search has hidden', async () => {
    await renderInTestApp(<Harness />);
    const passkeys = dot(/^Passkeys, Techniques, Adopt/);
    passkeys.focus();
    fireEvent.click(passkeys);
    fireEvent.change(screen.getByLabelText('Search technologies'), { target: { value: 'zero trust' } });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(document.activeElement).not.toBe(passkeys);
  });

  it('"/" jumps to the search box', async () => {
    await renderInTestApp(<Harness />);
    fireEvent.keyDown(document.body, { key: '/' });
    expect(document.activeElement).toBe(screen.getByLabelText('Search technologies'));
  });

  it('on a small screen the list leads, and the radar is one tap away', async () => {
    await renderInTestApp(<Harness wide={false} initial={{ view: undefined }} />);
    expect(chart()).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Passkeys, Techniques, Adopt/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Radar' }));
    expect(chart()).not.toBeNull();
  });

  it('tells the reader when it is showing a saved copy', async () => {
    await renderInTestApp(<Harness stale />);
    expect(screen.getByText(/Showing a saved copy/)).toBeInTheDocument();
  });

  it('explains how to read it, with the rings that this volume really uses', async () => {
    await renderInTestApp(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /How to read the radar/ }));
    expect(screen.getByText(/general reference, not a list of what any one company uses/)).toBeInTheDocument();
    expect(screen.getByText('Caution.')).toBeInTheDocument();
    expect(screen.queryByText('Hold.')).toBeNull();
  });
});
