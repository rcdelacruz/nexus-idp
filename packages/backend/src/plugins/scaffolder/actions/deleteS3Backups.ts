import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';

/**
 * Scaffolder action: aws:s3-delete-backups
 *
 * Deletes CNPG WAL/base-backup prefixes from S3 (or MinIO, via endpointUrl).
 * Credentials come from teardown:discover-resources, which resolved them from
 * the CNPG cluster's barman secret while the namespace still existed — by the
 * time this step runs the secret is already gone (kubernetes:delete-namespace
 * already ran). Uses the AWS SDK directly rather than the `aws` CLI: the
 * backend's runtime image has no CLI binaries installed.
 */
export function createDeleteS3BackupsAction() {
  return createTemplateAction({
    id: 'aws:s3-delete-backups',
    description: 'Delete CNPG backup prefixes from S3 or MinIO using previously-resolved credentials',
    schema: {
      input: z =>
        z.object({
          backups: z.array(z.object({
            destinationPath: z.string().describe('s3://bucket/prefix'),
            endpointUrl: z.string().optional().describe('Custom endpoint for MinIO — omit for AWS S3'),
            accessKeyId: z.string(),
            secretAccessKey: z.string(),
          })),
        }),
      output: z =>
        z.object({
          deleted: z.array(z.string()),
          failed: z.array(z.string()),
        }),
    },
    async handler(ctx) {
      const { backups } = ctx.input;
      const deleted: string[] = [];
      const failed: string[] = [];
      const seen = new Set<string>();

      for (const backup of backups) {
        if (seen.has(backup.destinationPath)) continue;
        seen.add(backup.destinationPath);

        const parsed = parseS3Uri(backup.destinationPath);
        if (!parsed) {
          ctx.logger.warn(`Could not parse S3 URI: ${backup.destinationPath}`);
          failed.push(backup.destinationPath);
          continue;
        }

        const client = new S3Client({
          region: 'us-east-1', // required by the SDK even for MinIO; ignored when endpoint is custom
          endpoint: backup.endpointUrl,
          forcePathStyle: !!backup.endpointUrl,
          credentials: {
            accessKeyId: backup.accessKeyId,
            secretAccessKey: backup.secretAccessKey,
          },
        });

        ctx.logger.info(`Deleting backups: ${backup.destinationPath}...`);
        try {
          // eslint-disable-next-line no-await-in-loop
          await deletePrefix(client, parsed.bucket, parsed.prefix);
          deleted.push(backup.destinationPath);
          ctx.logger.info(`Deleted: ${backup.destinationPath}`);
        } catch (err: any) {
          ctx.logger.warn(`Could not delete backups at ${backup.destinationPath}: ${err.message}`);
          failed.push(backup.destinationPath);
        } finally {
          client.destroy();
        }
      }

      ctx.output('deleted', deleted);
      ctx.output('failed', failed);
    },
  });
}

function parseS3Uri(uri: string): { bucket: string; prefix: string } | undefined {
  const match = uri.match(/^s3:\/\/([^/]+)\/?(.*)$/);
  if (!match) return undefined;
  return { bucket: match[1], prefix: match[2] };
}

async function deletePrefix(client: S3Client, bucket: string, prefix: string): Promise<void> {
  let continuationToken: string | undefined;
  do {
    // eslint-disable-next-line no-await-in-loop
    const list = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));

    const keys = (list.Contents ?? []).map(obj => obj.Key).filter((k): k is string => !!k);
    if (keys.length > 0) {
      // eslint-disable-next-line no-await-in-loop
      await client.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: keys.map(Key => ({ Key })) },
      }));
    }

    continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (continuationToken);
}
