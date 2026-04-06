/**
 * Check which regions have any resources across all accounts.
 * Checks EC2, EBS, RDS, ELB, EIP per region. S3 checked separately (global API).
 * Run: node plugins/finops-backend/test-active-regions.mjs
 */
import { EC2Client, DescribeInstancesCommand, DescribeVolumesCommand, DescribeAddressesCommand } from '@aws-sdk/client-ec2';
import { RDSClient, DescribeDBInstancesCommand } from '@aws-sdk/client-rds';
import { ElasticLoadBalancingV2Client, DescribeLoadBalancersCommand } from '@aws-sdk/client-elastic-load-balancing-v2';
import { S3Client, ListBucketsCommand, GetBucketLocationCommand } from '@aws-sdk/client-s3';
import { fromIni } from '@aws-sdk/credential-providers';

const PROFILES = [
  { name: 'nonprod', profile: 'cost-admin-nonprod' },
  { name: 'legacy',  profile: 'cost-admin-legacy' },
  { name: 'prod',    profile: 'cost-admin-prod' },
];

const REGIONS = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2', 'ap-northeast-3',
  'ap-south-1', 'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-north-1',
  'sa-east-1', 'ca-central-1',
];

async function hasResourcesInRegion(creds, region) {
  const checks = await Promise.all([
    new EC2Client({ region, credentials: creds }).send(new DescribeInstancesCommand({ MaxResults: 5 }))
      .then(r => (r.Reservations ?? []).reduce((n, x) => n + (x.Instances?.length ?? 0), 0) > 0).catch(() => false),
    new EC2Client({ region, credentials: creds }).send(new DescribeVolumesCommand({ MaxResults: 5 }))
      .then(r => (r.Volumes ?? []).length > 0).catch(() => false),
    new EC2Client({ region, credentials: creds }).send(new DescribeAddressesCommand({}))
      .then(r => (r.Addresses ?? []).length > 0).catch(() => false),
    new RDSClient({ region, credentials: creds }).send(new DescribeDBInstancesCommand({ MaxRecords: 5 }))
      .then(r => (r.DBInstances ?? []).length > 0).catch(() => false),
    new ElasticLoadBalancingV2Client({ region, credentials: creds }).send(new DescribeLoadBalancersCommand({ PageSize: 5 }))
      .then(r => (r.LoadBalancers ?? []).length > 0).catch(() => false),
  ]);
  return checks.some(Boolean);
}

async function getS3Regions(creds) {
  const client = new S3Client({ region: 'us-east-1', credentials: creds });
  const res = await client.send(new ListBucketsCommand({}));
  const buckets = res.Buckets ?? [];
  const locations = await Promise.all(
    buckets.map(async b => {
      try {
        const loc = await client.send(new GetBucketLocationCommand({ Bucket: b.Name }));
        return loc.LocationConstraint ?? 'us-east-1';
      } catch { return null; }
    })
  );
  return [...new Set(locations.filter(Boolean))];
}

const activePerAccount = {};

for (const { name, profile } of PROFILES) {
  console.log(`\n─── ${name} ───`);
  const creds = fromIni({ profile });

  const [regionResults, s3Regions] = await Promise.all([
    Promise.all(REGIONS.map(async region => ({ region, active: await hasResourcesInRegion(creds, region) }))),
    getS3Regions(creds),
  ]);

  const activeRegions = new Set(regionResults.filter(r => r.active).map(r => r.region));
  s3Regions.forEach(r => activeRegions.add(r));

  activePerAccount[name] = [...activeRegions].sort();
  console.log(activePerAccount[name].length ? activePerAccount[name].map(r => `  ${r}`).join('\n') : '  (none)');
}

console.log('\n─── Summary per account ───');
for (const [account, regions] of Object.entries(activePerAccount)) {
  console.log(`${account}: ${regions.join(', ')}`);
}
