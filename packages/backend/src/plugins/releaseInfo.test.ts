import { CompareStatus, findRelease } from './releaseInfo';

// Releases newest first; `contains` = tags whose history contains the commit.
const answer = (releases: string[], contains: string[], diverged: string[] = []) => {
  const asked: string[] = [];
  const result = findRelease(releases, async tag => {
    asked.push(tag);
    if (diverged.includes(tag)) return 'diverged' as CompareStatus;
    return (contains.includes(tag) ? 'behind' : 'ahead') as CompareStatus;
  });
  return result.then(r => ({ ...r, asked }));
};

describe('findRelease', () => {
  it('a build deployed before v1.6.0 was tagged is "in v1.6.0" (the 2026-10-31 About tab)', async () => {
    expect(await answer(['v1.6.0', 'v1.5.4', 'v1.5.3'], ['v1.6.0'])).toEqual({ includedIn: 'v1.6.0', asked: ['v1.6.0', 'v1.5.4'] });
  });

  it('a commit that shipped in an older release names that release, not a newer one', async () => {
    expect(await answer(['v1.6.0', 'v1.5.4', 'v1.5.3'], ['v1.6.0', 'v1.5.4'])).toEqual({ includedIn: 'v1.5.4', asked: ['v1.6.0', 'v1.5.4', 'v1.5.3'] });
  });

  it('an unreleased build says which release it builds on, with one GitHub call', async () => {
    expect(await answer(['v1.6.0', 'v1.5.4'], [])).toEqual({ after: 'v1.6.0', asked: ['v1.6.0'] });
  });

  it('a commit off the release line (diverged) claims nothing', async () => {
    expect(await answer(['v1.6.0'], [], ['v1.6.0'])).toEqual({ asked: ['v1.6.0'] });
  });

  it('no releases at all', async () => {
    expect(await answer([], [])).toEqual({ asked: [] });
  });
});
