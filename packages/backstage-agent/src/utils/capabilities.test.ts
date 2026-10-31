import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilitiesQuery, parseDockerInfo } from './capabilities';

test('reads Docker memory, CPUs and OS type from docker info', () => {
  assert.deepEqual(parseDockerInfo(JSON.stringify({ NCPU: 8, MemTotal: 8_217_542_656, OSType: 'linux' })), {
    cpus: 8,
    dockerMemoryBytes: 8_217_542_656,
    dockerOs: 'linux',
  });
});

test('ignores garbage and missing Docker', () => {
  assert.deepEqual(parseDockerInfo(''), {});
  assert.deepEqual(parseDockerInfo('not json'), {});
  assert.deepEqual(parseDockerInfo(JSON.stringify({ NCPU: -1, MemTotal: 'x', OSType: 'plan9' })), { cpus: undefined, dockerMemoryBytes: undefined, dockerOs: undefined });
});

test('builds the poll query with only the known values', () => {
  assert.equal(capabilitiesQuery({ arch: 'arm64', cpus: 10, dockerMemoryBytes: 4294967296, dockerOs: 'linux' }), 'arch=arm64&cpus=10&dockerMem=4294967296&dockerOs=linux');
  assert.equal(capabilitiesQuery({ arch: 'x64' }), 'arch=x64');
});
