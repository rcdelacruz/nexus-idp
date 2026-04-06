/**
 * Real AWS diagnostic — all resource types in a given region
 * Run: node plugins/finops-backend/test-scan-real.mjs <profile> <region> [thresholdDays]
 *
 * Example:
 *   node plugins/finops-backend/test-scan-real.mjs cost-admin-nonprod ap-southeast-1 730
 */

import { EC2Client, DescribeInstancesCommand, DescribeVolumesCommand, DescribeAddressesCommand } from '@aws-sdk/client-ec2';
import { RDSClient, DescribeDBInstancesCommand } from '@aws-sdk/client-rds';
import { ElasticLoadBalancingV2Client, DescribeLoadBalancersCommand } from '@aws-sdk/client-elastic-load-balancing-v2';
import { S3Client, ListBucketsCommand, GetBucketLocationCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { fromIni } from '@aws-sdk/credential-providers';

const profile  = process.argv[2];
const region   = process.argv[3] ?? 'ap-southeast-1';
const threshold = parseInt(process.argv[4] ?? '730', 10);

if (!profile) {
  console.error('Usage: node test-scan-real.mjs <profile> <region> [thresholdDays]');
  console.error('Example: node test-scan-real.mjs cost-admin-nonprod ap-southeast-1 730');
  process.exit(1);
}

const credentials = fromIni({ profile });
const cutoff = new Date();
cutoff.setDate(cutoff.getDate() - threshold);

console.log(`\n${'═'.repeat(60)}`);
console.log(`  Real AWS Scan — All Resource Types`);
console.log(`${'═'.repeat(60)}`);
console.log(`  Profile:   ${profile}`);
console.log(`  Region:    ${region}`);
console.log(`  Threshold: ${threshold} days (created before ${cutoff.toISOString().slice(0,10)})`);
console.log(`${'═'.repeat(60)}\n`);

function isOld(date) {
  return date && date < cutoff;
}
function age(date) {
  if (!date) return '?';
  return Math.floor((Date.now() - date.getTime()) / 86400000) + 'd';
}
function section(title, items, render) {
  console.log(`── ${title} ─────────────────────────`);
  if (items.length === 0) { console.log('   (none)\n'); return; }
  items.forEach(render);
  console.log();
}

const results = {};

// EC2
try {
  const t = Date.now();
  const ec2 = new EC2Client({ region, credentials });
  const res = await ec2.send(new DescribeInstancesCommand({
    Filters: [{ Name: 'instance-state-name', Values: ['running', 'stopped'] }],
  }));
  const all = (res.Reservations ?? []).flatMap(r => r.Instances ?? []);
  const old = all.filter(i => isOld(i.LaunchTime));
  results.ec2 = { total: all.length, old: old.length, items: old, ms: Date.now() - t };
} catch (e) { results.ec2 = { error: e.message }; }

// EBS
try {
  const t = Date.now();
  const ec2 = new EC2Client({ region, credentials });
  const res = await ec2.send(new DescribeVolumesCommand({ Filters: [{ Name: 'status', Values: ['available'] }] }));
  const all = res.Volumes ?? [];
  const old = all.filter(v => isOld(v.CreateTime));
  results.ebs = { total: all.length, old: old.length, items: old, ms: Date.now() - t };
} catch (e) { results.ebs = { error: e.message }; }

// RDS
try {
  const t = Date.now();
  const rds = new RDSClient({ region, credentials });
  const res = await rds.send(new DescribeDBInstancesCommand({}));
  const all = res.DBInstances ?? [];
  const old = all.filter(db => isOld(db.InstanceCreateTime));
  results.rds = { total: all.length, old: old.length, items: old, ms: Date.now() - t };
} catch (e) { results.rds = { error: e.message }; }

// ELB
try {
  const t = Date.now();
  const elb = new ElasticLoadBalancingV2Client({ region, credentials });
  const res = await elb.send(new DescribeLoadBalancersCommand({}));
  const all = res.LoadBalancers ?? [];
  const old = all.filter(lb => isOld(lb.CreatedTime));
  results.elb = { total: all.length, old: old.length, items: old, ms: Date.now() - t };
} catch (e) { results.elb = { error: e.message }; }

// EIP
try {
  const t = Date.now();
  const ec2 = new EC2Client({ region, credentials });
  const res = await ec2.send(new DescribeAddressesCommand({}));
  const all = (res.Addresses ?? []).filter(a => !a.AssociationId);
  results.eip = { total: all.length, old: all.length, items: all, ms: Date.now() - t };
} catch (e) { results.eip = { error: e.message }; }

// S3
try {
  const t = Date.now();
  const s3 = new S3Client({ region, credentials });
  const res = await s3.send(new ListBucketsCommand({}));
  const allBuckets = res.Buckets ?? [];

  const locations = await Promise.all(allBuckets.map(async b => {
    try {
      const loc = await s3.send(new GetBucketLocationCommand({ Bucket: b.Name }));
      return { ...b, bucketRegion: loc.LocationConstraint ?? 'us-east-1' };
    } catch { return { ...b, bucketRegion: 'unknown' }; }
  }));

  const inRegion = locations.filter(b => b.bucketRegion === region);
  const old = inRegion.filter(b => isOld(b.CreationDate));
  results.s3 = { total: allBuckets.length, inRegion: inRegion.length, old: old.length, items: old, ms: Date.now() - t };
} catch (e) { results.s3 = { error: e.message }; }

// ── Print results ──────────────────────────────────────────────

section('EC2 Instances', results.ec2?.error ? [] : (results.ec2?.items ?? []), i => {
  const name = i.Tags?.find(t => t.Key === 'Name')?.Value ?? '';
  console.log(`   ${i.InstanceId} (${i.InstanceType}) [${i.State?.Name}] created ${i.LaunchTime?.toISOString().slice(0,10)} — ${age(i.LaunchTime)}${name ? ' — ' + name : ''}`);
});
if (results.ec2?.error) console.log(`   ERROR: ${results.ec2.error}\n`);
else console.log(`   Summary: ${results.ec2.old} old / ${results.ec2.total} total running+stopped (${results.ec2.ms}ms)\n`);

section('EBS Volumes (unattached)', results.ebs?.error ? [] : (results.ebs?.items ?? []), v => {
  console.log(`   ${v.VolumeId} (${v.Size}GB ${v.VolumeType}) created ${v.CreateTime?.toISOString().slice(0,10)} — ${age(v.CreateTime)}`);
});
if (results.ebs?.error) console.log(`   ERROR: ${results.ebs.error}\n`);
else console.log(`   Summary: ${results.ebs.old} old / ${results.ebs.total} total unattached (${results.ebs.ms}ms)\n`);

section('RDS Instances', results.rds?.error ? [] : (results.rds?.items ?? []), db => {
  console.log(`   ${db.DBInstanceIdentifier} (${db.DBInstanceClass}) [${db.DBInstanceStatus}] created ${db.InstanceCreateTime?.toISOString().slice(0,10)} — ${age(db.InstanceCreateTime)}`);
});
if (results.rds?.error) console.log(`   ERROR: ${results.rds.error}\n`);
else console.log(`   Summary: ${results.rds.old} old / ${results.rds.total} total (${results.rds.ms}ms)\n`);

section('Load Balancers', results.elb?.error ? [] : (results.elb?.items ?? []), lb => {
  console.log(`   ${lb.LoadBalancerName} (${lb.Type}) [${lb.State?.Code}] created ${lb.CreatedTime?.toISOString().slice(0,10)} — ${age(lb.CreatedTime)}`);
});
if (results.elb?.error) console.log(`   ERROR: ${results.elb.error}\n`);
else console.log(`   Summary: ${results.elb.old} old / ${results.elb.total} total (${results.elb.ms}ms)\n`);

section('Elastic IPs (unassociated)', results.eip?.error ? [] : (results.eip?.items ?? []), a => {
  console.log(`   ${a.PublicIp} (${a.AllocationId})`);
});
if (results.eip?.error) console.log(`   ERROR: ${results.eip.error}\n`);
else console.log(`   Summary: ${results.eip.old} unassociated (${results.eip.ms}ms)\n`);

section(`S3 Buckets in ${region}`, results.s3?.error ? [] : (results.s3?.items ?? []), b => {
  console.log(`   ${b.Name} — created ${b.CreationDate?.toISOString().slice(0,10)} — ${age(b.CreationDate)}`);
});
if (results.s3?.error) console.log(`   ERROR: ${results.s3.error}\n`);
else console.log(`   Summary: ${results.s3.old} old / ${results.s3.inRegion} in region / ${results.s3.total} total buckets (${results.s3.ms}ms)\n`);

console.log(`${'═'.repeat(60)}`);
const totalOld = (results.ec2?.old ?? 0) + (results.ebs?.old ?? 0) + (results.rds?.old ?? 0) + (results.elb?.old ?? 0) + (results.eip?.old ?? 0) + (results.s3?.old ?? 0);
console.log(`  TOTAL old resources found: ${totalOld}`);
console.log(`${'═'.repeat(60)}\n`);
