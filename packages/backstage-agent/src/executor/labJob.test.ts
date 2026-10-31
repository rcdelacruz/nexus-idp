// Run with: yarn test:unit
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLabJob } from './DockerComposeExecutor';

const ok = {
  image: 'hashicorp/terraform:1.11.4',
  files: { 'grade.py': 'cHJpbnQoMSk=', 'run.sh': 'ZWNobw==' },
  clone: { url: 'https://github.com/stratpoint-engineering/terraform-capstone-x', ref: 'capstone-final' },
  networkOfService: 'ministack',
  command: ['sh', '/job/run.sh'],
  env: { PHASE: 'pre', AWS_ENDPOINT_URL: 'http://ministack:4566' },
  outFile: 'out.json',
};

test('accepts a well-formed grading job', () => {
  assert.equal(validateLabJob(ok), undefined);
});

test('rejects anything that could escape the job folder or the lab', () => {
  const cases: [string, any][] = [
    ['image with a shell char', { ...ok, image: 'alpine:3;rm -rf /' }],
    ['image without a tag', { ...ok, image: 'alpine' }],
    ['file path traversal', { ...ok, files: { '../evil': 'eA==' } }],
    ['file in a subdir', { ...ok, files: { 'a/b': 'eA==' } }],
    ['file named repo (the clone target)', { ...ok, files: { repo: 'eA==' } }],
    ['empty command', { ...ok, command: [] }],
    ['non-string command', { ...ok, command: ['sh', 1] }],
    ['lowercase env key', { ...ok, env: { path: '/x' } }],
    ['non-https clone', { ...ok, clone: { url: 'git@github.com:o/r.git' } }],
    ['ref with ..', { ...ok, clone: { ...ok.clone, ref: '../../etc' } }],
    ['ref with spaces', { ...ok, clone: { ...ok.clone, ref: 'a b' } }],
    ['bad service', { ...ok, networkOfService: 'x y' }],
    ['outFile path', { ...ok, outFile: '../out.json' }],
  ];
  for (const [name, job] of cases) assert.notEqual(validateLabJob(job), undefined, name);
});
