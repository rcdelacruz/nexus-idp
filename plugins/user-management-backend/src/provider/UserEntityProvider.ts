import {
  EntityProvider,
  EntityProviderConnection,
} from '@backstage/plugin-catalog-node';
import { UserEntity } from '@backstage/catalog-model';
import { LoggerService, SchedulerServiceTaskRunner } from '@backstage/backend-plugin-api';
import { UserStore } from '../database/UserStore';

const DEPT_TEAMS = ['web-team', 'mobile-team', 'data-team', 'cloud-team', 'ai-team', 'qa-team', 'pm-team', 'sa-team'];

export class UserEntityProvider implements EntityProvider {
  private connection?: EntityProviderConnection;
  // Accept a Promise so the catalog module's init() doesn't need to await the store.
  // This prevents a startup deadlock where the catalog module blocks waiting for the
  // user-management plugin to start (which can't start if the catalog module is blocking).
  private readonly storePromise: Promise<UserStore>;

  constructor(
    store: UserStore | Promise<UserStore>,
    private readonly taskRunner: SchedulerServiceTaskRunner,
    private readonly logger: LoggerService,
  ) {
    this.storePromise = store instanceof Promise ? store : Promise.resolve(store);
  }

  getProviderName(): string {
    return 'user-management';
  }

  async connect(connection: EntityProviderConnection): Promise<void> {
    this.connection = connection;
    await this.taskRunner.run({
      id: `${this.getProviderName()}:refresh`,
      fn: async () => {
        await this.refresh();
      },
    });
  }

  async refresh(): Promise<void> {
    if (!this.connection) {
      throw new Error('UserEntityProvider is not connected');
    }

    this.logger.info('UserEntityProvider: refreshing user entities from database');

    const store = await this.storePromise;
    const allUsers = await store.getAll();
    // Skip ghost rows: users who linked GitHub before completing registration have
    // teams=[] and is_admin=false. Emitting catalog entities for these would conflict
    // with YAML-defined users and incorrectly override their group memberships.
    const users = allUsers.filter(
      u => u.teams.some(t => DEPT_TEAMS.includes(t)) || u.is_admin,
    );
    const entities: UserEntity[] = users.map(user => this.toEntity(user));

    await this.connection.applyMutation({
      type: 'full',
      entities: entities.map(entity => ({
        entity,
        locationKey: `user-management-provider`,
      })),
    });

    this.logger.info(`UserEntityProvider: applied ${entities.length} user entities`);
  }

  private buildMemberOf(teams: string[], isLead: boolean, isAdmin: boolean): string[] {
    const groups = new Set<string>(['general-engineers']);
    for (const team of teams) {
      if (DEPT_TEAMS.includes(team)) {
        groups.add(team);
        if (isLead) {
          groups.add(team.replace('-team', '-lead'));
        }
      }
    }
    if (isAdmin) {
      groups.add('backstage-admins');
    }
    return Array.from(groups);
  }

  private toEntity(user: {
    name: string;
    display_name: string;
    email: string;
    teams: string[];
    is_lead: boolean;
    is_admin: boolean;
    github_username: string | null;
  }): UserEntity {
    const memberOf = this.buildMemberOf(user.teams, user.is_lead, user.is_admin);

    return {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'User',
      metadata: {
        name: user.name,
        namespace: 'default',
        annotations: {
          // Must be <type>:<target> format — bare string fails catalog processing
          'backstage.io/managed-by-location': `user-management-provider:${user.name}`,
          'backstage.io/managed-by-origin-location': 'user-management-provider:default',
          ...(user.github_username
            ? { 'github.com/user-login': user.github_username }
            : {}),
        },
      },
      spec: {
        profile: {
          displayName: user.display_name,
          email: user.email,
        },
        memberOf,
      },
    };
  }
}
