/**
 * Check which regions are opted-in for each AWS account.
 * Run: node plugins/finops-backend/test-regions.mjs
 */
import { EC2Client, DescribeRegionsCommand } from '@aws-sdk/client-ec2';
import { fromIni } from '@aws-sdk/credential-providers';

const PROFILES = [
  { name: 'nonprod', profile: 'cost-admin-nonprod' },
  { name: 'legacy',  profile: 'cost-admin-legacy' },
  { name: 'prod',    profile: 'cost-admin-prod' },
];

for (const { name, profile } of PROFILES) {
  console.log(`\n─── ${name} (${profile}) ───`);
  try {
    const client = new EC2Client({
      region: 'us-east-1',
      credentials: fromIni({ profile }),
    });
    const res = await client.send(new DescribeRegionsCommand({ AllRegions: true }));
    const regions = (res.Regions ?? [])
      .filter(r => r.OptInStatus !== 'not-opted-in')
      .map(r => `  ${r.RegionName} (${r.OptInStatus})`)
      .sort();
    console.log(regions.join('\n'));
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
}
