import { formatBuildDate, parseGitVersion, readBuildInfo } from './buildInfo';

describe('formatBuildDate', () => {
  it('formats with a time zone without throwing (dateStyle + timeZoneName is invalid in Intl)', () => {
    expect(formatBuildDate(Date.UTC(2026, 9, 29, 9, 8), 'en-US', 'Asia/Manila')).toBe(
      'Oct 29, 2026, 5:08 PM GMT+8',
    );
  });
});

describe('parseGitVersion', () => {
  it('parses an exact tag', () => {
    expect(parseGitVersion('v1.5.3')).toEqual({ tag: 'v1.5.3', commitsAhead: 0 });
  });

  it('parses a tag with commits ahead', () => {
    expect(parseGitVersion('v1.5.3-4-ge82421a')).toEqual({ tag: 'v1.5.3', commitsAhead: 4 });
  });

  it('keeps a pre-release suffix as part of the tag', () => {
    expect(parseGitVersion('v1.6.0-rc.1')).toEqual({ tag: 'v1.6.0-rc.1', commitsAhead: 0 });
    expect(parseGitVersion('v1.6.0-rc.1-2-gabc1234')).toEqual({ tag: 'v1.6.0-rc.1', commitsAhead: 2 });
  });

  it('returns no tag for a bare sha, unknown or empty input', () => {
    expect(parseGitVersion('e82421a')).toEqual({ tag: null, commitsAhead: 0 });
    expect(parseGitVersion('unknown')).toEqual({ tag: null, commitsAhead: 0 });
    expect(parseGitVersion(undefined)).toEqual({ tag: null, commitsAhead: 0 });
  });
});

describe('readBuildInfo', () => {
  it('returns null when BUILD_INFO is not injected (tests, non-bundled runs)', () => {
    expect(readBuildInfo()).toBeNull();
  });
});
