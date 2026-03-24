import { fromIni, fromEnv } from '@aws-sdk/credential-providers';
import { CostExplorerClient } from '@aws-sdk/client-cost-explorer';
import { EC2Client } from '@aws-sdk/client-ec2';
import { RDSClient } from '@aws-sdk/client-rds';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { BudgetsClient } from '@aws-sdk/client-budgets';
import { STSClient } from '@aws-sdk/client-sts';
import { ElasticLoadBalancingV2Client } from '@aws-sdk/client-elastic-load-balancing-v2';
import { S3Client } from '@aws-sdk/client-s3';
import { CloudFrontClient } from '@aws-sdk/client-cloudfront';
import { AwsCredentialIdentityProvider } from '@aws-sdk/types';

export class AwsClientFactory {
  private readonly credentials: AwsCredentialIdentityProvider;
  private readonly defaultRegion: string;

  constructor(profile: string, region: string, accountId?: string) {
    this.defaultRegion = region;
    // Production: per-account env vars take priority
    //   AWS_ACCESS_KEY_ID_NONPROD + AWS_SECRET_ACCESS_KEY_NONPROD
    //   AWS_ACCESS_KEY_ID_LEGACY  + AWS_SECRET_ACCESS_KEY_LEGACY
    //   AWS_ACCESS_KEY_ID_PROD    + AWS_SECRET_ACCESS_KEY_PROD
    // Falls back to generic AWS_ACCESS_KEY_ID (shared / single-account prod setup)
    // Local dev: reads named profile from ~/.aws/credentials via fromIni()
    const suffix = accountId ? `_${accountId.toUpperCase()}` : '';
    const keyId = process.env[`AWS_ACCESS_KEY_ID${suffix}`];
    const secretKey = process.env[`AWS_SECRET_ACCESS_KEY${suffix}`];

    if (keyId && secretKey) {
      this.credentials = async () => ({
        accessKeyId: keyId,
        secretAccessKey: secretKey,
      });
    } else if (process.env.AWS_ACCESS_KEY_ID) {
      this.credentials = fromEnv();
    } else {
      this.credentials = fromIni({ profile });
    }
  }

  costExplorer() {
    return new CostExplorerClient({ region: 'us-east-1', credentials: this.credentials });
  }

  budgets() {
    return new BudgetsClient({ region: 'us-east-1', credentials: this.credentials });
  }

  sts() {
    return new STSClient({ region: this.defaultRegion, credentials: this.credentials });
  }

  ec2(region = this.defaultRegion) {
    return new EC2Client({ region, credentials: this.credentials });
  }

  rds(region = this.defaultRegion) {
    return new RDSClient({ region, credentials: this.credentials });
  }

  cloudwatch(region = this.defaultRegion) {
    return new CloudWatchClient({ region, credentials: this.credentials });
  }

  elb(region = this.defaultRegion) {
    return new ElasticLoadBalancingV2Client({ region, credentials: this.credentials });
  }

  s3(region = this.defaultRegion) {
    return new S3Client({ region, credentials: this.credentials });
  }

  cloudfront() {
    // CloudFront is a global service — always us-east-1
    return new CloudFrontClient({ region: 'us-east-1', credentials: this.credentials });
  }
}
