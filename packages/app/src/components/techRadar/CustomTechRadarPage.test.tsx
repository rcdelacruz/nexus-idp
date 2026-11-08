import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderInTestApp } from '@backstage/test-utils';
import sample from './__fixtures__/vol34-sample.json';
import { parseRadar } from './radarModel';
import { CustomTechRadarPage } from './CustomTechRadarPage';
import { RadarLoadError, loadLatestRadar } from './radarSource';

jest.mock('./radarSource', () => ({
  ...jest.requireActual('./radarSource'),
  loadLatestRadar: jest.fn(),
}));

const load = loadLatestRadar as jest.MockedFunction<typeof loadLatestRadar>;
const { radar } = parseRadar(sample, { volume: 34, label: 'Vol. 34 · April 2026' });

afterEach(() => jest.resetAllMocks());

describe('CustomTechRadarPage', () => {
  it('shows the loading state, then the radar with its volume in the header', async () => {
    let finish!: (v: { radar: typeof radar; stale: boolean }) => void;
    load.mockReturnValue(new Promise(r => (finish = r)));
    await renderInTestApp(<CustomTechRadarPage />);
    expect(screen.getByText('Loading the radar…')).toBeInTheDocument();
    finish({ radar, stale: false });
    expect(await screen.findByText(/Thoughtworks Technology Radar · Vol\. 34 · April 2026/)).toBeInTheDocument();
    expect(screen.getByText('118 of 118 technologies')).toBeInTheDocument();
  });

  it('says what failed and lets the user try again', async () => {
    load.mockRejectedValueOnce(new RadarLoadError('GitHub answered 403 when listing the radar volumes'));
    await renderInTestApp(<CustomTechRadarPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('The radar could not be loaded.');
    expect(screen.getByText(/GitHub answered 403/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open the radar on thoughtworks.com/ })).toHaveAttribute('href', 'https://www.thoughtworks.com/radar');

    load.mockResolvedValueOnce({ radar, stale: false });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('118 of 118 technologies')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('opens the technology named in the link', async () => {
    load.mockResolvedValue({ radar, stale: false });
    await renderInTestApp(<CustomTechRadarPage />, { routeEntries: ['/tech-radar?blip=passkeys'] });
    expect(await screen.findByRole('complementary', { name: 'Details: Passkeys' })).toBeInTheDocument();
  });

  it('applies the search and filters in the link', async () => {
    load.mockResolvedValue({ radar, stale: false });
    await renderInTestApp(<CustomTechRadarPage />, { routeEntries: ['/tech-radar?quadrant=tools&ring=adopt'] });
    expect(await screen.findByText('5 of 118 technologies')).toBeInTheDocument();
  });

  it('marks a saved copy', async () => {
    load.mockResolvedValue({ radar, stale: true });
    await renderInTestApp(<CustomTechRadarPage />);
    await waitFor(() => expect(screen.getByText(/Showing a saved copy/)).toBeInTheDocument());
  });
});
