import yaml from 'js-yaml';

const DEPT_TEAMS = ['web-team', 'mobile-team', 'data-team', 'cloud-team', 'ai-team', 'qa-team', 'pm-team', 'sa-team'];

export interface UserEntry {
  name: string;           // e.g. "john.doe"
  displayName: string;
  email: string;
  teams: string[];        // dept teams to assign
  isLead?: boolean;
  githubUsername?: string;
}

interface GitHubFileResponse {
  content: string;  // base64
  sha: string;
}

interface YamlDoc {
  apiVersion?: string;
  kind?: string;
  metadata?: { name?: string; description?: string; annotations?: Record<string, string> };
  spec?: {
    profile?: { email?: string; displayName?: string; picture?: string };
    memberOf?: string[];
  };
}

export class GitHubUsersService {
  constructor(
    private readonly token: string,
    private readonly repoOwner: string,
    private readonly repoName: string,
    private readonly filePath: string,
  ) {}

  private async getFile(): Promise<GitHubFileResponse> {
    const res = await fetch(
      `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/contents/${this.filePath}`,
      { headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github.v3+json' } },
    );
    if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
    return res.json() as Promise<GitHubFileResponse>;
  }

  private async putFile(content: string, sha: string, message: string): Promise<void> {
    const encoded = Buffer.from(content, 'utf8').toString('base64');
    const res = await fetch(
      `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/contents/${this.filePath}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message, content: encoded, sha }),
      },
    );
    if (!res.ok) throw new Error(`GitHub commit error: ${res.status} ${await res.text()}`);
  }

  /** Build the memberOf array for a user based on teams + lead flag */
  private buildMemberOf(teams: string[], isLead?: boolean): string[] {
    const groups = new Set<string>(['general-engineers']);
    for (const team of teams) {
      if (DEPT_TEAMS.includes(team)) {
        groups.add(team);
        if (isLead) {
          const leadGroup = team.replace('-team', '-lead');
          groups.add(leadGroup);
        }
      }
    }
    return Array.from(groups);
  }

  /** Upsert a user in users.yaml — creates if not exists, updates if exists */
  async upsertUser(entry: UserEntry): Promise<void> {
    const { content: b64, sha } = await this.getFile();
    const raw = Buffer.from(b64, 'base64').toString('utf8');

    // Parse all YAML documents
    const docs: YamlDoc[] = [];
    yaml.loadAll(raw, doc => { if (doc && typeof doc === 'object') docs.push(doc as YamlDoc); });

    const memberOf = this.buildMemberOf(entry.teams, entry.isLead);
    const existing = docs.find(
      d => d.kind === 'User' && d.metadata?.name === entry.name,
    );

    if (existing) {
      // Update existing entry
      existing.spec = existing.spec ?? {};
      existing.spec.memberOf = memberOf;
      existing.spec.profile = existing.spec.profile ?? {};
      if (entry.displayName) existing.spec.profile.displayName = entry.displayName;
      if (entry.email) existing.spec.profile.email = entry.email;
      if (entry.githubUsername) {
        existing.metadata = existing.metadata ?? {};
        existing.metadata.annotations = existing.metadata.annotations ?? {};
        existing.metadata.annotations['github.com/user-login'] = entry.githubUsername;
      }
    } else {
      // Add new user document
      const newDoc: YamlDoc = {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'User',
        metadata: {
          name: entry.name,
          description: entry.displayName,
          ...(entry.githubUsername
            ? { annotations: { 'github.com/user-login': entry.githubUsername } }
            : {}),
        },
        spec: {
          profile: {
            email: entry.email,
            displayName: entry.displayName,
          },
          memberOf,
        },
      };
      docs.push(newDoc);
    }

    // Serialize back
    const newContent =
      `# This file is managed by Nexus IDP. Manual edits are allowed but may be overwritten.\n` +
      docs.map(d => '---\n' + yaml.dump(d, { lineWidth: -1 })).join('\n');

    await this.putFile(
      newContent,
      sha,
      `chore(users): ${existing ? 'update' : 'add'} user ${entry.name} → [${memberOf.join(', ')}]`,
    );
  }
}
