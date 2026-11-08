import { labTaskPath, parseLabTaskPath } from './labTaskPath';

const ID = '3f2b8c1e-5a7d-4e90-9b1c-0d4e6f8a1b2c';

describe('parseLabTaskPath', () => {
  it('reads the task id from a lab path', () => {
    expect(parseLabTaskPath(`/local-provisioner/tasks/${ID}`)).toBe(ID);
  });

  it('accepts one trailing slash', () => {
    expect(parseLabTaskPath(`/local-provisioner/tasks/${ID}/`)).toBe(ID);
  });

  it('lowercases the id, because task ids come back lowercase from the database', () => {
    expect(parseLabTaskPath(`/local-provisioner/tasks/${ID.toUpperCase()}`)).toBe(ID);
  });

  it.each([
    ['the Local Provisioner page', '/local-provisioner'],
    ['the Local Provisioner page with a slash', '/local-provisioner/'],
    ['the Trainees page', '/local-provisioner/trainees'],
    ['the tasks folder with no id', '/local-provisioner/tasks/'],
    ['an id that is not a uuid', '/local-provisioner/tasks/not-a-task'],
    ['a short uuid', '/local-provisioner/tasks/3f2b8c1e-5a7d-4e90-9b1c'],
    ['an extra segment after the id', `/local-provisioner/tasks/${ID}/logs`],
    ['two trailing slashes', `/local-provisioner/tasks/${ID}//`],
    ['a path climbing out of the folder', `/local-provisioner/tasks/${ID}/../trainees`],
    ['a query string', `/local-provisioner/tasks/${ID}?x=1`],
    ['a fragment', `/local-provisioner/tasks/${ID}#top`],
    ['an absolute URL', `https://evil.example/local-provisioner/tasks/${ID}`],
    ['a protocol-relative URL', `//evil.example/local-provisioner/tasks/${ID}`],
    ['a path with a prefix', `/x/local-provisioner/tasks/${ID}`],
    ['a different prefix of the same length', `/local-provisioner/tasksX${ID}`],
    ['another page whose name has the same length', `/local-provisioner/taskz/${ID}`],
    ['25 arbitrary characters before a uuid', `${'x'.repeat(25)}${ID}`],
    ['a path with a leading space', ` /local-provisioner/tasks/${ID}`],
    ['the catalog', '/catalog/default/resource/some-lab'],
    ['an empty string', ''],
  ])('ignores %s', (_name, value) => {
    expect(parseLabTaskPath(value)).toBeUndefined();
  });

  it('ignores values that are not strings', () => {
    expect(parseLabTaskPath(undefined)).toBeUndefined();
    expect(parseLabTaskPath(null)).toBeUndefined();
    expect(parseLabTaskPath(42 as any)).toBeUndefined();
  });
});

describe('labTaskPath', () => {
  it('builds the path that parseLabTaskPath reads back', () => {
    expect(labTaskPath(ID)).toBe(`/local-provisioner/tasks/${ID}`);
    expect(parseLabTaskPath(labTaskPath(ID))).toBe(ID);
  });
});
