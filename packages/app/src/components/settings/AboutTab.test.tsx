import React from 'react';
import { screen } from '@testing-library/react';
import { configApiRef } from '@backstage/core-plugin-api';
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

const renderTab = (config: object) =>
  renderInTestApp(
    <TestApiProvider apis={[[configApiRef, mockApis.config({ data: config })]]}>
      <AboutTab />
    </TestApiProvider>,
  );

describe('AboutTab', () => {
  it('renders every version row from config and build info', async () => {
    mockReadBuildInfo.mockReturnValue(BUILD_INFO);
    await renderTab({ app: { backstage: { version: '1.56.2' } } });

    expect(screen.getByText('1.56.2')).toBeInTheDocument();
    expect(screen.getByText('v1.5.3')).toBeInTheDocument();
    expect(screen.getByText('5 commits ahead')).toBeInTheDocument();
    expect(screen.getByText('8cb9318')).toHaveAttribute('title', BUILD_INFO.commit);
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });

  it('falls back to "unknown" without config or build info', async () => {
    mockReadBuildInfo.mockReturnValue(null);
    await renderTab({});

    expect(screen.getAllByText('unknown')).toHaveLength(4);
  });
});
