/**
 * Test script that mirrors the exact ResourceService scan logic.
 * Run: node plugins/finops-backend/test-resource-service.mjs <profile> <region> [thresholdDays]
 *
 * Example:
 *   node plugins/finops-backend/test-resource-service.mjs cost-admin-legacy ap-southeast-1 730
 */

import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeVolumesCommand,
  DescribeAddressesCommand,
  DescribeVpcEndpointsCommand,
} from '@aws-sdk/client-ec2';
import { RDSClient, DescribeDBInstancesCommand } from '@aws-sdk/client-rds';
import { ElasticLoadBalancingV2Client, DescribeLoadBalancersCommand } from '@aws-sdk/client-elastic-load-balancing-v2';
import { S3Client, ListBucketsCommand, GetBucketLocationCommand } from '@aws-sdk/client-s3';
import { fromIni } from '@aws-sdk/credential-providers';

const profile = process.argv[2];
const region  = process.argv[3] ?? 'ap-southeast-1';
const thresholdDays = process.argv[4] ? parseInt(process.argv[4], 10) : undefined;

if (!profile) {
  console.error('Usage: node test-resource-service.mjs <profile> <region> [thresholdDays]');
  process.exit(1);
}

const credentials = fromIni({ profile });

function isOlderThan(date, days) {
  if (!date) return false;
  if (!days) return true; // no threshold → include everything
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return date < cutoff;
}

function ageInDays(date) {
  if (!date) return undefined;
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`  ResourceService Scan (mirrors backend logic exactly)`);
console.log(`${'═'.repeat(60)}`);
console.log(`  Profile:   ${profile}`);
console.log(`  Region:    ${region}`);
console.log(`  Threshold: ${thresholdDays ?? 'none (show all)'} days`);
console.log(`${'═'.repeat(60)}\n`);

// ── EC2 ──────────────────────────────────────────────────────────────────────
console.log('Scanning EC2...');
const t1 = Date.now();
try {
  const ec2 = new EC2Client({ region, credentials });
  const res = await ec2.send(new DescribeInstancesCommand({
    Filters: [{ Name: 'instance-state-name', Values: ['running', 'stopped'] }],
  }));
  const all = (res.Reservations ?? []).flatMap(r => r.Instances ?? []);
  const filtered = all.filter(i => isOlderThan(i.LaunchTime, thresholdDays));
  console.log(`  EC2: ${filtered.length} match (${all.length} total) — ${Date.now() - t1}ms`);
  filtered.slice(0, 3).forEach(i => console.log(`    ${i.InstanceId} [${i.State?.Name}] created ${i.LaunchTime?.toISOString().slice(0,10)} (${ageInDays(i.LaunchTime)}d)`));
} catch (e) { console.log(`  EC2 ERROR: ${e.message}`); }

// ── EBS ──────────────────────────────────────────────────────────────────────
console.log('Scanning EBS...');
const t2 = Date.now();
try {
  const ec2 = new EC2Client({ region, credentials });
  const res = await ec2.send(new DescribeVolumesCommand({
    Filters: [{ Name: 'status', Values: ['available'] }],
  }));
  const all = res.Volumes ?? [];
  const filtered = all.filter(v => isOlderThan(v.CreateTime, thresholdDays));
  console.log(`  EBS: ${filtered.length} match (${all.length} total) — ${Date.now() - t2}ms`);
} catch (e) { console.log(`  EBS ERROR: ${e.message}`); }

// ── RDS ──────────────────────────────────────────────────────────────────────
console.log('Scanning RDS...');
const t3 = Date.now();
try {
  const rds = new RDSClient({ region, credentials });
  const res = await rds.send(new DescribeDBInstancesCommand({}));
  const all = res.DBInstances ?? [];
  const filtered = all.filter(db => isOlderThan(db.InstanceCreateTime, thresholdDays));
  console.log(`  RDS: ${filtered.length} match (${all.length} total) — ${Date.now() - t3}ms`);
} catch (e) { console.log(`  RDS ERROR: ${e.message}`); }

// ── ELB ──────────────────────────────────────────────────────────────────────
console.log('Scanning ELB...');
const t4 = Date.now();
try {
  const elb = new ElasticLoadBalancingV2Client({ region, credentials });
  const res = await elb.send(new DescribeLoadBalancersCommand({}));
  const all = res.LoadBalancers ?? [];
  const filtered = all.filter(lb => isOlderThan(lb.CreatedTime, thresholdDays));
  console.log(`  ELB: ${filtered.length} match (${all.length} total) — ${Date.now() - t4}ms`);
} catch (e) { console.log(`  ELB ERROR: ${e.message}`); }

// ── EIP ──────────────────────────────────────────────────────────────────────
console.log('Scanning EIP...');
const t5 = Date.now();
try {
  const ec2 = new EC2Client({ region, credentials });
  const res = await ec2.send(new DescribeAddressesCommand({}));
  const unassociated = (res.Addresses ?? []).filter(a => !a.AssociationId);
  console.log(`  EIP: ${unassociated.length} unassociated — ${Date.now() - t5}ms`);
} catch (e) { console.log(`  EIP ERROR: ${e.message}`); }

// ── S3 (mirrors ResourceService exactly: no date filter, ALL in parallel) ────
console.log('Scanning S3 (NO date filter — all GetBucketLocation in parallel)...');
const t6 = Date.now();
try {
  const s3 = new S3Client({ region, credentials });
  const res = await s3.send(new ListBucketsCommand({}));
  const buckets = res.Buckets ?? [];
  console.log(`  ListBuckets: ${buckets.length} total — ${Date.now() - t6}ms`);

  const tLoc = Date.now();
  const locations = await Promise.all(
    buckets.map(async bucket => {
      try {
        const loc = await s3.send(new GetBucketLocationCommand({ Bucket: bucket.Name ?? '' }));
        return { bucket, bucketRegion: loc.LocationConstraint ?? 'us-east-1' };
      } catch {
        return { bucket, bucketRegion: 'unknown' };
      }
    }),
  );
  console.log(`  GetBucketLocation (${buckets.length} parallel): ${Date.now() - tLoc}ms`);
  const inRegion = locations.filter(l => l.bucketRegion === region).map(l => l.bucket);

  console.log(`\n  S3 RESULT: ${inRegion.length} buckets in ${region} (NO date filter) — total ${Date.now() - t6}ms`);
  inRegion.slice(0, 5).forEach(b =>
    console.log(`    ${b.Name} — created ${b.CreationDate?.toISOString().slice(0,10)} (${ageInDays(b.CreationDate)}d)`),
  );
  if (inRegion.length > 5) console.log(`    ... and ${inRegion.length - 5} more`);
} catch (e) { console.log(`  S3 ERROR: ${e.message}`); }

// ── VPC Endpoints ─────────────────────────────────────────────────────────────
console.log('\nScanning VPC Endpoints...');
const t7 = Date.now();
try {
  const ec2 = new EC2Client({ region, credentials });
  const res = await ec2.send(new DescribeVpcEndpointsCommand({
    Filters: [{ Name: 'vpc-endpoint-state', Values: ['available'] }],
  }));
  const all = res.VpcEndpoints ?? [];
  const filtered = all.filter(ep =>
    (ep.RouteTableIds ?? []).length === 0 &&
    (ep.NetworkInterfaceIds ?? []).length === 0 &&
    isOlderThan(ep.CreationTimestamp, thresholdDays),
  );
  console.log(`  VPC Endpoints: ${filtered.length} match (${all.length} total) — ${Date.now() - t7}ms`);
} catch (e) { console.log(`  VPC Endpoints ERROR: ${e.message}`); }

console.log(`\n${'═'.repeat(60)}\n`);
