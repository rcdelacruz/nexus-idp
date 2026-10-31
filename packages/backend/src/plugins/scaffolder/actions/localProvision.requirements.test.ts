import { machineRequirementProblem } from './localProvision';

const GB = 1024 ** 3;

describe('machineRequirementProblem', () => {
  it('lets a machine through when it has enough Docker memory (allowing for Docker under-reporting by ~5%)', () => {
    expect(machineRequirementProblem({ minDockerMemoryGb: 4 }, { arch: 'arm64', dockerMemoryBytes: 3.8 * GB })).toBeUndefined();
  });

  it('stops a lab with the fix when Docker has too little memory', () => {
    const p = machineRequirementProblem({ minDockerMemoryGb: 4 }, { arch: 'arm64', dockerMemoryBytes: 2 * GB });
    expect(p).toMatch(/needs about 4 GB of memory for Docker; yours has 2\.0 GB/);
    expect(p).toMatch(/Docker Desktop .*Settings → Resources → Memory/);
    expect(p).toMatch(/\.wslconfig/);
  });

  it('stops a lab on an unsupported CPU architecture', () => {
    expect(machineRequirementProblem({ architectures: ['x64'] }, { arch: 'arm64' })).toMatch(/doesn't run on your machine's CPU \(arm64\)/);
  });

  it('never blocks on unknowns: no requirements, an older agent, or a missing value', () => {
    expect(machineRequirementProblem(undefined, { dockerMemoryBytes: 1 })).toBeUndefined();
    expect(machineRequirementProblem({ minDockerMemoryGb: 8 }, undefined)).toBeUndefined();
    expect(machineRequirementProblem({ minDockerMemoryGb: 8 }, { arch: 'x64' })).toBeUndefined();
  });
});
