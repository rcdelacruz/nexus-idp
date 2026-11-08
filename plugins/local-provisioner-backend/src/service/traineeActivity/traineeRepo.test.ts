import { capstoneRepoPrefixes } from './traineeRepo';

import { repoNameBelongsTo, traineeNameFromEmail } from './traineeRepo';

describe('the name a person has inside repo names', () => {
  it('is the sign-in before the @, the way the lab form builds it', () => {
    expect(traineeNameFromEmail('jane.doe@example.com')).toBe('jane-doe');
    expect(traineeNameFromEmail('Ann_Lee+x@example.com')).toBe('ann-lee-x');
    expect(traineeNameFromEmail('bob@example.com')).toBe('bob');
  });

  it('must end the repo name, between hyphens, followed by the date-time or the older epoch', () => {
    const ok = (repo: string, name: string) => repoNameBelongsTo(repo, name);
    expect(ok('linux-capstone-a-jane-doe-20261103-1001', 'jane-doe')).toBe(true);
    expect(ok('training-ministack-training-ann-1761901200', 'ann')).toBe(true);
    expect(ok('Terraform-Capstone-A-Jane-Doe-20261103-0739', 'jane-doe')).toBe(true);
    expect(ok('linux-capstone-a-jane-doe-20261103-1001', 'bob')).toBe(false);
    expect(ok('linux-capstone-a-joann-lee-20261103-1001', 'ann-lee')).toBe(false); // not at a hyphen boundary
    expect(ok('linux-capstone-a-joann-20261103-1001', 'ann')).toBe(false);
    expect(ok('linux-capstone-a-ann-20261103', 'ann')).toBe(false); // no time
    expect(ok('backstage-main', 'ann')).toBe(false);
    expect(ok('linux-capstone-a--20261103-1001', '')).toBe(false);
  });

  it('is not fooled by regular-expression characters in a name', () => {
    expect(repoNameBelongsTo('x-a.b-20261103-1001', 'a.b')).toBe(true);
    expect(repoNameBelongsTo('x-axb-20261103-1001', 'a.b')).toBe(false);
  });
});

describe('capstoneRepoPrefixes', () => {
  it('accepts the A/B repo naming, the pre-A/B naming for -b, and the id form', () => {
    expect(capstoneRepoPrefixes('linux-a')).toEqual(['linux-capstone-a', 'linux-a-capstone']);
    expect(capstoneRepoPrefixes('python-a')).toEqual(['python-capstone-a', 'python-a-capstone']);
    expect(capstoneRepoPrefixes('terraform-b')).toEqual(['terraform-capstone-b', 'terraform-capstone', 'terraform-b-capstone']);
    expect(capstoneRepoPrefixes('nodejs-a')).toEqual(['nodejs-capstone-a', 'nodejs-a-capstone']);
  });

  it('keeps the id form for an id that is not family-a/b', () => {
    expect(capstoneRepoPrefixes('nodejs')).toEqual(['nodejs-capstone']);
  });
});
