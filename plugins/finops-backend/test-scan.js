/**
 * Test script for multi-region scan: concurrency limit + per-region timeout
 * Run: node plugins/finops-backend/test-scan.js
 */

const REGION_CONCURRENCY = 3;
const REGION_TIMEOUT_MS = 15_000;

const ALL_REGIONS = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2',
  'eu-west-1', 'eu-west-2', 'eu-central-1',
  'sa-east-1', 'ca-central-1',
];

// ─── Replicated core logic from resourceRoutes.ts ────────────────────────────

function emptyRegionResult() {
  return { ec2: [], ebs: [], rds: [], elb: [], eip: [], s3: [], vpcEndpoints: [] };
}

async function scanRegion(mockFn, region, timeoutMs) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), timeoutMs),
  );
  return Promise.race([mockFn(region), timeout]);
}

async function scanInBatches(mockFn, regions, timeoutMs, concurrency) {
  const results = new Map();
  const timedOut = [];

  for (let i = 0; i < regions.length; i += concurrency) {
    const batch = regions.slice(i, i + concurrency);
    const batchStart = Date.now();
    process.stdout.write(`  Batch ${Math.floor(i / concurrency) + 1}: [${batch.join(', ')}] ... `);

    await Promise.all(
      batch.map(async region => {
        try {
          results.set(region, await scanRegion(mockFn, region, timeoutMs));
        } catch {
          timedOut.push(region);
          results.set(region, emptyRegionResult());
        }
      }),
    );

    console.log(`done in ${Date.now() - batchStart}ms`);
  }

  return { results, timedOut };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

async function testConcurrencyLimit() {
  console.log('\n[Test 1] Concurrency — only 3 regions run at a time');
  let activeCount = 0;
  let maxActive = 0;

  const mock = async region => {
    activeCount++;
    maxActive = Math.max(maxActive, activeCount);
    await new Promise(r => setTimeout(r, 200)); // simulate 200ms per region
    activeCount--;
    return { ...emptyRegionResult(), ec2: [{ resource_id: region }] };
  };

  const start = Date.now();
  const { results, timedOut } = await scanInBatches(mock, ALL_REGIONS, REGION_TIMEOUT_MS, REGION_CONCURRENCY);
  const elapsed = Date.now() - start;

  assert(maxActive <= REGION_CONCURRENCY, `Max concurrent regions = ${maxActive} (limit: ${REGION_CONCURRENCY})`);
  assert(timedOut.length === 0, `No regions timed out`);
  assert(results.size === ALL_REGIONS.length, `All ${ALL_REGIONS.length} regions returned results`);

  // 13 regions / 3 concurrency = 5 batches × 200ms ≈ 1000ms
  const expectedMin = Math.ceil(ALL_REGIONS.length / REGION_CONCURRENCY) * 200;
  assert(elapsed >= expectedMin * 0.8, `Elapsed ${elapsed}ms confirms batching (expected ~${expectedMin}ms)`);
}

async function testTimeoutSkipsSlowRegion() {
  console.log('\n[Test 2] Timeout — slow regions are skipped, fast ones still return');
  const SLOW_REGIONS = ['us-east-1', 'eu-west-1'];
  const TEST_TIMEOUT = 500;

  const mock = async region => {
    const delay = SLOW_REGIONS.includes(region) ? 2000 : 100;
    await new Promise(r => setTimeout(r, delay));
    return { ...emptyRegionResult(), ec2: [{ resource_id: region }] };
  };

  const { results, timedOut } = await scanInBatches(
    mock,
    ['us-east-1', 'us-east-2', 'us-west-1'],
    TEST_TIMEOUT,
    REGION_CONCURRENCY,
  );

  assert(
    SLOW_REGIONS.filter(r => ['us-east-1'].includes(r)).every(r => timedOut.includes(r)),
    `Slow region 'us-east-1' was marked as timed out`,
  );
  assert(
    results.get('us-east-2')?.ec2.length > 0,
    `Fast region 'us-east-2' still returned results`,
  );
  assert(
    results.get('us-east-1')?.ec2.length === 0,
    `Timed-out region 'us-east-1' returned empty results (not an error)`,
  );
}

async function testPartialResults() {
  console.log('\n[Test 3] Partial results — one region errors, rest succeed');

  const mock = async region => {
    if (region === 'ap-southeast-1') throw new Error('timeout');
    return { ...emptyRegionResult(), ec2: [{ resource_id: region }] };
  };

  const regions = ['us-east-1', 'ap-southeast-1', 'eu-west-1'];
  const { results, timedOut } = await scanInBatches(mock, regions, REGION_TIMEOUT_MS, REGION_CONCURRENCY);

  assert(timedOut.includes('ap-southeast-1'), `Errored region marked as timed out`);
  assert(results.get('us-east-1')?.ec2.length === 1, `us-east-1 has results`);
  assert(results.get('eu-west-1')?.ec2.length === 1, `eu-west-1 has results`);
  assert(results.size === 3, `All 3 regions present in results map`);
}

async function testMergeAggregation() {
  console.log('\n[Test 4] Merge — results from all regions are aggregated');

  const mock = async region => ({
    ...emptyRegionResult(),
    ec2: [{ resource_id: `i-${region}` }],
    ebs: [{ resource_id: `vol-${region}` }],
  });

  const regions = ['us-east-1', 'us-east-2', 'us-west-1'];
  const { results } = await scanInBatches(mock, regions, REGION_TIMEOUT_MS, REGION_CONCURRENCY);

  const merged = Array.from(results.values()).reduce(
    (acc, r) => ({
      ec2: [...acc.ec2, ...r.ec2],
      ebs: [...acc.ebs, ...r.ebs],
    }),
    { ec2: [], ebs: [] },
  );

  assert(merged.ec2.length === 3, `Merged EC2: ${merged.ec2.length} instances (one per region)`);
  assert(merged.ebs.length === 3, `Merged EBS: ${merged.ebs.length} volumes (one per region)`);
}

// ─── Run all tests ────────────────────────────────────────────────────────────

(async () => {
  console.log('=== FinOps Multi-Region Scan: Concurrency + Timeout Tests ===');

  await testConcurrencyLimit();
  await testTimeoutSkipsSlowRegion();
  await testPartialResults();
  await testMergeAggregation();

  console.log(`\n${'─'.repeat(52)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
