import { LoggerService, CacheService } from '@backstage/backend-plugin-api';
import { Config } from '@backstage/config';
import { GitHubDocsService, DocSourceConfig } from './GitHubDocsService';

export interface SourceInfo {
  id: string;
  label: string;
  description?: string;
  service: GitHubDocsService;
}

// Default source used when no engineeringDocs.sources config is provided
const DEFAULT_SOURCE: DocSourceConfig & { id: string; label: string } = {
  id: 'engineering-docs',
  label: 'Engineering Hub',
  repoOwner: 'stratpoint-engineering',
  repoName: 'engineering-hub',
  branch: 'main',
  contentBase: 'src/content',
};

export class SourceRegistry {
  private readonly sources = new Map<string, SourceInfo>();
  private readonly token: string;
  private readonly adHocCache = new Map<string, GitHubDocsService>();

  constructor(
    private readonly logger: LoggerService,
    config: Config,
    private readonly cache: CacheService,
  ) {
    const integrations = config.getConfigArray('integrations.github');
    this.token = integrations[0].getString('token');

    const sourcesConfig = config.getOptionalConfigArray('engineeringDocs.sources') ?? [];

    if (sourcesConfig.length > 0) {
      for (const s of sourcesConfig) {
        const id = s.getString('id');
        const sourceConfig: DocSourceConfig = {
          repoOwner: s.getString('repoOwner'),
          repoName: s.getString('repoName'),
          branch: s.getOptionalString('branch') ?? 'main',
          contentBase: s.getOptionalString('contentBase') ?? 'docs',
        };
        this.sources.set(id, {
          id,
          label: s.getOptionalString('label') ?? id,
          description: s.getOptionalString('description'),
          service: new GitHubDocsService(logger, this.token, sourceConfig, cache.withOptions({ defaultTtl: 30 * 60 * 1000 })),
        });
      }
    } else {
      // Fallback: single default source
      this.sources.set(DEFAULT_SOURCE.id, {
        id: DEFAULT_SOURCE.id,
        label: DEFAULT_SOURCE.label,
        service: new GitHubDocsService(logger, this.token, DEFAULT_SOURCE, cache.withOptions({ defaultTtl: 30 * 60 * 1000 })),
      });
    }
  }

  get(id: string): SourceInfo | undefined {
    return this.sources.get(id);
  }

  getDefault(): SourceInfo {
    return this.sources.values().next().value as SourceInfo;
  }

  list(): Array<{ id: string; label: string; description?: string }> {
    return Array.from(this.sources.values()).map(({ id, label, description }) => ({ id, label, description }));
  }

  /** Get or create a GitHubDocsService for an ad-hoc (entity-annotated) repo. */
  getOrCreateAdHoc(sourceConfig: DocSourceConfig): GitHubDocsService {
    const key = `${sourceConfig.repoOwner}/${sourceConfig.repoName}@${sourceConfig.branch}:${sourceConfig.contentBase}`;
    if (!this.adHocCache.has(key)) {
      this.adHocCache.set(
        key,
        new GitHubDocsService(this.logger, this.token, sourceConfig, this.cache.withOptions({ defaultTtl: 30 * 60 * 1000 })),
      );
    }
    return this.adHocCache.get(key)!;
  }
}
