/**
 * Real AWS diagnostic for S3 scan in ap-southeast-1
 * Run: node plugins/finops-backend/test-s3-real.mjs <profile> [thresholdDays]
 *
 * Example:
 *   node plugins/finops-backend/test-s3-real.mjs cost-admin-nonprod 730
 */

import { S3Client, ListBucketsCommand, GetBucketLocationCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { fromIni } from '@aws-sdk/credential-providers';

const profile = process.argv[2];
const thresholdDays = parseInt(process.argv[3] ?? '730', 10);
const TARGET_REGION = 'ap-southeast-1';

if (!profile) {
  console.error('Usage: node test-s3-real.mjs <aws-profile> [thresholdDays]');
  console.error('Profiles: cost-admin-nonprod | cost-admin-legacy | cost-admin-prod');
  process.exit(1);
}

const credentials = fromIni({ profile });
const client = new S3Client({ region: TARGET_REGION, credentials });

function isOlderThan(date, days) {
  if (!date) return false;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return date < cutoff;
}

function ageInDays(date) {
  if (!date) return 0;
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

console.log(`\n=== S3 Real Scan Diagnostic ===`);
console.log(`Profile:   ${profile}`);
console.log(`Region:    ${TARGET_REGION}`);
console.log(`Threshold: ${thresholdDays} days (older than ${new Date(Date.now() - thresholdDays * 86400000).toISOString().slice(0,10)})\n`);

try {
  // Step 1: list all buckets
  console.log('Step 1: ListBuckets...');
  const start1 = Date.now();
  const res = await client.send(new ListBucketsCommand({}));
  const buckets = res.Buckets ?? [];
  console.log(`  Found ${buckets.length} total buckets (${Date.now() - start1}ms)\n`);

  // Step 2: check locations
  console.log(`Step 2: GetBucketLocation for each bucket (checking for ${TARGET_REGION})...`);
  const start2 = Date.now();
  const locationResults = await Promise.all(
    buckets.map(async bucket => {
      const name = bucket.Name ?? '';
      try {
        const loc = await client.send(new GetBucketLocationCommand({ Bucket: name }));
        const bucketRegion = loc.LocationConstraint ?? 'us-east-1';
        return { name, creationDate: bucket.CreationDate, bucketRegion };
      } catch (err) {
        return { name, creationDate: bucket.CreationDate, bucketRegion: 'ERROR: ' + err.message };
      }
    }),
  );
  console.log(`  Location check done (${Date.now() - start2}ms)`);

  const regionBuckets = locationResults.filter(b => b.bucketRegion === TARGET_REGION);
  const otherRegions = [...new Set(locationResults.filter(b => b.bucketRegion !== TARGET_REGION).map(b => b.bucketRegion))];
  console.log(`  In ${TARGET_REGION}: ${regionBuckets.length} buckets`);
  console.log(`  In other regions: ${locationResults.length - regionBuckets.length} buckets (${otherRegions.slice(0,5).join(', ')}${otherRegions.length > 5 ? '...' : ''})\n`);

  if (regionBuckets.length === 0) {
    console.log(`⚠  No buckets found in ${TARGET_REGION}. Check the correct account/profile.`);
    process.exit(0);
  }

  // Step 3: apply age filter
  console.log(`Step 3: Applying age filter (older than ${thresholdDays} days)...`);
  const oldBuckets = regionBuckets.filter(b => isOlderThan(b.creationDate, thresholdDays));
  const skipped = regionBuckets.length - oldBuckets.length;
  console.log(`  ${oldBuckets.length} buckets pass age filter, ${skipped} skipped (too new)\n`);

  if (oldBuckets.length === 0) {
    console.log(`⚠  All ${TARGET_REGION} buckets are newer than ${thresholdDays} days. Try a smaller threshold.`);
    // Show what creation dates look like
    regionBuckets.slice(0, 5).forEach(b => {
      console.log(`  - ${b.name}: created ${b.creationDate?.toISOString().slice(0,10)} (${ageInDays(b.creationDate)} days old)`);
    });
    process.exit(0);
  }

  // Step 4: check object count for old buckets
  console.log(`Step 4: Checking object count for ${oldBuckets.length} old buckets...`);
  const start4 = Date.now();
  const finalResults = await Promise.all(
    oldBuckets.map(async b => {
      try {
        const objects = await client.send(new ListObjectsV2Command({ Bucket: b.name, MaxKeys: 1 }));
        const isEmpty = (objects.KeyCount ?? 0) === 0;
        return { ...b, isEmpty, state: isEmpty ? 'empty' : 'has-objects' };
      } catch (err) {
        return { ...b, isEmpty: false, state: 'ERROR: ' + err.message };
      }
    }),
  );
  console.log(`  Object check done (${Date.now() - start4}ms)\n`);

  // Step 5: show results
  console.log(`=== Results: ${finalResults.length} S3 buckets in ${TARGET_REGION} older than ${thresholdDays} days ===\n`);
  const empty = finalResults.filter(b => b.isEmpty);
  const hasObjects = finalResults.filter(b => !b.isEmpty);

  console.log(`Empty (safe to delete): ${empty.length}`);
  empty.forEach(b => console.log(`  ✓ ${b.name} — created ${b.creationDate?.toISOString().slice(0,10)} (${ageInDays(b.creationDate)} days)`));

  console.log(`\nHas objects (review before deleting): ${hasObjects.length}`);
  hasObjects.slice(0, 20).forEach(b => console.log(`  ⚠ ${b.name} — created ${b.creationDate?.toISOString().slice(0,10)} (${ageInDays(b.creationDate)} days)`));
  if (hasObjects.length > 20) console.log(`  ... and ${hasObjects.length - 20} more`);

} catch (err) {
  console.error('\n✗ Fatal error:', err.message);
  if (err.name === 'CredentialsProviderError') {
    console.error(`  → AWS profile "${profile}" not found in ~/.aws/credentials`);
    console.error(`  → Available profiles: cost-admin-nonprod | cost-admin-legacy | cost-admin-prod`);
  }
  process.exit(1);
}
