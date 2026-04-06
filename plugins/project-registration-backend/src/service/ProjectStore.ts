import { DatabaseService, resolvePackagePath } from '@backstage/backend-plugin-api';
import { Knex } from 'knex';

export interface Project {
  id: string;
  name: string;
  description?: string;
  client_name: string;
  type: 'client' | 'system';
  aws_tag_project: string;
  aws_tag_client: string;
  aws_tag_team: string;
  start_date?: string;
  end_date?: string;
  pm_tool?: string;
  jira_key?: string;
  jira_template?: string;
  jira_project_id?: string;
  github_project_id?: string;
  team_name?: string;
  team_members?: object[];
  status: 'active' | 'archived';
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  client_name: string;
  aws_tag_project?: string;
  aws_tag_client?: string;
  aws_tag_team?: string;
  start_date?: string;
  end_date?: string;
  pm_tool?: string;
  jira_key?: string;
  jira_template?: string;
  team_name?: string;
  team_members?: object[];
  created_by: string;
}

/** DB row representation — team_members is stored as a JSON string column. */
type ProjectRow = Omit<Project, 'team_members'> & { team_members?: string };

const TABLE = 'project_registration_projects';

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 64);
}

export class ProjectStore {
  private db: Knex;

  constructor(db: Knex) {
    this.db = db;
  }

  static async create(database: DatabaseService): Promise<ProjectStore> {
    const client = await database.getClient();
    await client.migrate.latest({
      directory: resolvePackagePath('@stratpoint/plugin-project-registration-backend', 'src/database/migrations'),
    });
    return new ProjectStore(client);
  }

  async listProjects(includeArchived = false): Promise<Project[]> {
    let query = this.db<Project>(TABLE).orderBy([
      { column: 'type', order: 'asc' },  // system projects first
      { column: 'name', order: 'asc' },
    ]);
    if (!includeArchived) {
      query = query.where('status', 'active');
    }
    return query;
  }

  async getProject(id: string): Promise<Project | undefined> {
    return this.db<Project>(TABLE).where({ id }).first();
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    const aws_tag_project = input.aws_tag_project || slugify(input.name);
    const aws_tag_client = input.aws_tag_client || slugify(input.client_name);
    const aws_tag_team = input.aws_tag_team || slugify(input.team_name || input.client_name);

    const [project] = await this.db<ProjectRow>(TABLE)
      .insert({
        name: input.name,
        description: input.description,
        client_name: input.client_name,
        type: 'client',
        aws_tag_project,
        aws_tag_client,
        aws_tag_team,
        start_date: input.start_date,
        end_date: input.end_date,
        pm_tool: input.pm_tool,
        jira_key: input.jira_key,
        jira_template: input.jira_template,
        team_name: input.team_name,
        team_members: input.team_members !== null ? JSON.stringify(input.team_members) : undefined,
        status: 'active',
        created_by: input.created_by,
      })
      .returning('*');
    return project as unknown as Project;
  }

  async archiveProject(id: string): Promise<void> {
    const project = await this.getProject(id);
    if (!project) throw new Error(`Project ${id} not found`);
    if (project.type === 'system') throw new Error('System projects cannot be archived');
    await this.db<Project>(TABLE).where({ id }).update({ status: 'archived', updated_at: new Date().toISOString() });
  }

  async unarchiveProject(id: string): Promise<void> {
    const project = await this.getProject(id);
    if (!project) throw new Error(`Project ${id} not found`);
    await this.db<Project>(TABLE).where({ id }).update({ status: 'active', updated_at: new Date().toISOString() });
  }

  async updateProject(id: string, input: Partial<Pick<Project,
    'name' | 'description' | 'client_name' | 'start_date' | 'end_date' |
    'pm_tool' | 'jira_key' | 'jira_template' | 'team_name' | 'team_members'
  >>): Promise<Project> {
    const project = await this.getProject(id);
    if (!project) throw new Error(`Project ${id} not found`);
    if (project.type === 'system') throw new Error('System projects cannot be updated');
    const { team_members, ...rest } = input;
    const payload: Partial<ProjectRow> = {
      ...rest,
      updated_at: new Date().toISOString(),
      ...(team_members !== null && { team_members: JSON.stringify(team_members) }),
    };
    const [updated] = await this.db<ProjectRow>(TABLE)
      .where({ id })
      .update(payload)
      .returning('*');
    return updated as unknown as Project;
  }

  async deleteProject(id: string): Promise<void> {
    const project = await this.getProject(id);
    if (!project) throw new Error(`Project ${id} not found`);
    if (project.type === 'system') throw new Error('System projects cannot be deleted');
    await this.db<Project>(TABLE).where({ id }).delete();
  }
}
