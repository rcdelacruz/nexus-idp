import React from 'react';
import { screen } from '@testing-library/react';
import { configApiRef, discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { mockApis, renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { AboutTab } from './AboutTab';
import { readBuildInfo } from './buildInfo';

// process.env coerces assigned values to strings, so BUILD_INFO (an object literal substituted by
// the bundler's DefinePlugin in real builds) can't be emulated through process.env — mock the reader.
jest.mock('./buildInfo', () => ({
  ...jest.requireActual('./buildInfo'),
  readBuildInfo: jest.fn(),
}));
const mockReadBuildInfo = readBuildInfo as jest.MockedFunction<typeof readBuildInfo>;

const BUILD_INFO = {
  cliVersion: '0.36.7',
  gitVersion: 'v1.5.3-5-g8cb9318',
  packageVersion: '0.0.0',
  timestamp: Date.UTC(2026, 9, 29, 9, 8),
  commit: '8cb93181a000c56d2738361b1cdc8e731789eb53',
};

/** The release-info backend's answer for the build's commit ({} = unknown / GitHub unreachable). */
const renderTab = (config: object, release: object | Error = {}) =>
  renderInTestApp(
    <TestApiProvider
      apis={[
        [configApiRef, mockApis.config({ data: config })],
        [discoveryApiRef, { getBaseUrl: async () => 'http://backend/api/release-info' }],
        [
          fetchApiRef,
          {
            fetch: async () => {
              if (release instanceof Error) throw release;
              return { ok: true, json: async () => release };
            },
          },
        ],
      ]}
    >
      <AboutTab />
    </TestApiProvider>,
  );

describe('AboutTab', () => {
  it('renders every version row from config and build info', async () => {
    mockReadBuildInfo.mockReturnValue(BUILD_INFO);
    await renderTab({ app: { backstage: { version: '1.56.2' } } });

    expect(screen.getByText('1.56.2')).toBeInTheDocument();
    expect(screen.getByText('v1.5.3')).toBeInTheDocument();
    expect(screen.queryByText(/commits? ahead/)).not.toBeInTheDocument();
    expect(screen.getByText('8cb9318')).toHaveAttribute('title', BUILD_INFO.commit);
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });

  it('falls back to "unknown" without config or build info', async () => {
    mockReadBuildInfo.mockReturnValue(null);
    await renderTab({});

    expect(screen.getAllByText('unknown')).toHaveLength(4);
  });

  it('shows the release that includes the build, even one tagged after the deploy (2026-10-31)', async () => {
    mockReadBuildInfo.mockReturnValue({ ...BUILD_INFO, gitVersion: 'v1.5.4-62-g3f0811d' });
    await renderTab({ app: { backstage: { version: '1.56.2' } } }, { includedIn: 'v1.6.0' });
    expect(await screen.findByText('v1.6.0')).toHaveAttribute('title', 'The published release that includes this build');
    expect(screen.queryByText('v1.5.4')).not.toBeInTheDocument();
  });

  it('a build newer than the latest release shows that release only, nothing about commits past it', async () => {
    mockReadBuildInfo.mockReturnValue(BUILD_INFO);
    await renderTab({}, { after: 'v1.6.0' });
    expect(await screen.findByText('v1.6.0')).toBeInTheDocument();
    expect(screen.queryByText(/unreleased|ahead/)).not.toBeInTheDocument();
  });

  it('falls back to the build-time tag when GitHub cannot be asked', async () => {
    mockReadBuildInfo.mockReturnValue(BUILD_INFO);
    await renderTab({}, new Error('offline'));
    expect(await screen.findByText('v1.5.3')).toBeInTheDocument();
  });
});
