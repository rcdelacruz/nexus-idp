import { currentStep, formatDuration, stepLabel, timeline } from './activity';
import { ProvisioningTask } from './types';

const at = (m: number, s = 0) => new Date(Date.UTC(2026, 9, 31, 0, m, s)).toISOString();
const task = (p: Partial<ProvisioningTask>): ProvisioningTask => ({
  id: 't', agentId: 'a', userId: 'u', taskType: 'provision-training', resourceName: 'linux-capstone-x', config: {},
  status: 'in-progress', createdAt: at(25), updatedAt: at(30), startedAt: at(25), ...p,
});
// The real step names the Linux lab's agent (0.1.25) sent on 2026-10-31.
const linuxRun = [
  { at: at(25, 15), step: 'creating the VM' },
  { at: at(29, 51), step: 'copying the seed' },
  { at: at(29, 51), step: 'copying seed.sh' },
  { at: at(29, 52), step: 'seeding the server (10–20 min)' },
];

describe('activity', () => {
  it('labels old and new agent step names in plain words', () => {
    expect(stepLabel('pulling-images')).toBe('Downloading images');
    expect(stepLabel('seeding the server (10–20 min)')).toBe('Setting up the server');
    expect(stepLabel('copying seed.sh')).toBe('Copying the lab files into the VM');
    expect(stepLabel('building backend from source')).toBe('Building backend from source');
  });

  it('builds the timeline: merged repeats, durations, the running step last', () => {
    const steps = timeline(task({ metadata: { activity: linuxRun } }), new Date(at(36, 52)));
    expect(steps.map(s => [s.label, formatDuration(s.durationMs), s.running])).toEqual([
      ['Creating the VM', '4 min', false],
      ['Copying the lab files into the VM', '1 s', false],
      ['Setting up the server', '7 min', true],
    ]);
  });

  it('says what a running task is doing, for how long, with its typical duration', () => {
    const now = currentStep(task({ metadata: { activity: linuxRun } }), new Date(at(36, 52)));
    expect(now).toEqual({ label: 'Setting up the server', sinceMs: 7 * 60_000, hint: 'usually 10–20 min', percent: undefined });
    const pulling = currentStep(task({ metadata: { activity: [{ at: at(1), step: 'creating the VM' }], progress: { percent: 42.4 } } }), new Date(at(2)));
    expect(pulling?.percent).toBe(42);
  });

  it('a pending task is waiting for the agent; a finished one has no current step', () => {
    expect(currentStep(task({ status: 'pending' }), new Date(at(26)))?.label).toBe('Waiting for your agent to pick it up');
    expect(currentStep(task({ status: 'completed', completedAt: at(40) }))).toBeUndefined();
  });

  it('a finished timeline ends at Ready without a running step', () => {
    const steps = timeline(task({ status: 'completed', completedAt: at(40), metadata: { activity: [...linuxRun, { at: at(40), step: 'completed' }] } }));
    expect(steps[steps.length - 1]).toMatchObject({ label: 'Ready', running: false, durationMs: 0 });
    expect(steps[2]).toMatchObject({ label: 'Setting up the server', running: false });
  });

  it('formats durations', () => {
    expect([formatDuration(8_000), formatDuration(6 * 60_000), formatDuration(65 * 60_000), formatDuration(120 * 60_000)]).toEqual(['8 s', '6 min', '1 h 5 min', '2 h']);
  });
});
