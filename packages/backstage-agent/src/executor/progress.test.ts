import test from 'node:test';
import assert from 'node:assert/strict';
import { ComposeProgress, OutputTail, percentIn, throttledReporter } from './progress';

test('OutputTail keeps the last lines, strips colour and collapses \\r redraws', () => {
  const t = new OutputTail(3);
  t.push('\x1b[32mone\x1b[0m\ntwo\n');
  t.push('Retrieving image: 10%\rRetrieving image: 55%\r');
  t.push('Retrieving image: 90%\nthree\nfour');
  assert.equal(t.text(), 'Retrieving image: 90%\nthree\nfour');
});

test('percentIn reads a percentage from progress output', () => {
  assert.equal(percentIn('Retrieving image: 45%'), 45);
  assert.equal(percentIn('Downloading 12.7 %'), 12);
  assert.equal(percentIn('no number'), undefined);
  assert.equal(percentIn('250%'), undefined);
});

test('ComposeProgress reads real Compose v5.6.1 output', () => {
  const c = new ComposeProgress('e2e-progress-1');
  const lines = [
    ' app Skipped No image to be pulled',
    ' Image busybox:1.36.1 Pulling ',
    ' 034d6572bf28 Downloading 1.049MB',
    ' Image e2e-progress-1-app Building ',
    '#3 [internal] load metadata for docker.io/library/alpine:3.20',
    '#6 [2/3] RUN echo step-a && sleep 1',
    '#7 [3/3] RUN echo step-b && sleep 1',
    ' Image e2e-progress-1-app Built ',
    ' Container e2e-progress-1-app-1 Started',
  ];
  assert.deepEqual(lines.map(l => c.line(l)), [
    undefined,
    { phase: 'Downloading images', detail: { image: 'busybox:1.36.1' } },
    undefined,
    { phase: 'Building app from source' },
    undefined,
    { phase: 'Building app from source', detail: { progress: { percent: 67, step: '2/3' } } },
    { phase: 'Building app from source', detail: { progress: { percent: 100, step: '3/3' } } },
    undefined,
    { phase: 'Starting the containers' },
  ]);
});

test('ComposeProgress also reads Compose v2 and v1 output', () => {
  const c = new ComposeProgress('lab');
  assert.deepEqual(c.line('#12 [backend 4/7] RUN npm ci'), {
    phase: 'Building backend from source', detail: { progress: { percent: 57, step: '4/7' } },
  });
  assert.deepEqual(c.line(' ✔ kafka Pulled'), { phase: 'Downloading images', detail: { image: 'kafka' } });
  assert.deepEqual(c.line('Pulling postgres ... done'), { phase: 'Downloading images', detail: { image: 'postgres' } });
  assert.deepEqual(c.line(' ✔ Container lab-db-1  Started'), { phase: 'Starting the containers' });
  assert.equal(c.line('#5 [1/3] FROM alpine'), undefined, 'a bare step before any "Building" line has no service');
  assert.equal(c.line('some random line'), undefined);
});

test('throttledReporter: new steps at once, same-step updates at most every interval, latest wins', () => {
  let clock = 0;
  const sent: Array<[string, any]> = [];
  const timers: Array<() => void> = [];
  const r = throttledReporter((p, d) => sent.push([p, d]), 3000, () => clock, fn => timers.push(fn));
  r('Creating the VM');
  r('Creating the VM', { progress: { percent: 10 } }); // within 3 s: deferred
  r('Creating the VM', { progress: { percent: 20 } }); // replaces the deferred one
  assert.equal(sent.length, 1);
  clock = 3000;
  timers.shift()!();
  assert.deepEqual(sent.map(([p, d]) => [p, d.progress?.percent]), [['Creating the VM', undefined], ['Creating the VM', 20]]);
  r('Setting up the server'); // a new step goes out at once
  assert.equal(sent[2][0], 'Setting up the server');
  assert.equal(sent[2][1].at, new Date(3000).toISOString());
});

test('a deferred update of an old step is dropped once a newer step started', () => {
  let clock = 0;
  const sent: string[] = [];
  const timers: Array<() => void> = [];
  const r = throttledReporter(p => sent.push(p), 3000, () => clock, fn => timers.push(fn));
  r('Creating the VM');
  r('Creating the VM', { output: 'x' });
  clock = 1000;
  r('Copying the lab files into the VM');
  clock = 3000;
  timers.shift()!();
  assert.deepEqual(sent, ['Creating the VM', 'Copying the lab files into the VM']);
});
