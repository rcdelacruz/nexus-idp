import { Router } from 'express';
import { LoggerService, HttpAuthService, UserInfoService } from '@backstage/backend-plugin-api';
import { ProjectStore } from './ProjectStore';

export function createRouter(options: {
  logger: LoggerService;
  httpAuth: HttpAuthService;
  userInfo: UserInfoService;
  projectStore: ProjectStore;
}): Router {
  const { logger, httpAuth, userInfo, projectStore } = options;
  const router = Router();
  router.use(require('express').json());

  /**
   * GET /projects
   * List all active projects — used by scaffolder dropdown and project list page.
   * All authenticated users can list projects.
   */
  router.get('/projects', async (req, res) => {
    try {
      await httpAuth.credentials(req as any, { allow: ['user'] });
      const includeArchived = req.query.includeArchived === 'true';
      const projects = await projectStore.listProjects(includeArchived);
      return res.json({ projects, total: projects.length });
    } catch (err: any) {
      if (err.name === 'AuthenticationError' || err.message?.includes('credentials')) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      logger.error('Failed to list projects', { error: err.message });
      return res.status(500).json({ error: 'Failed to list projects' });
    }
  });

  /**
   * GET /projects/:id
   * Get a single project by ID.
   * All authenticated users can read project details.
   */
  router.get('/projects/:id', async (req, res) => {
    try {
      await httpAuth.credentials(req as any, { allow: ['user'] });
      const project = await projectStore.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }
      return res.json(project);
    } catch (err: any) {
      if (err.name === 'AuthenticationError' || err.message?.includes('credentials')) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      logger.error('Failed to get project', { error: err.message });
      return res.status(500).json({ error: 'Failed to get project' });
    }
  });

  /**
   * POST /projects
   * Create a new project.
   * PM and admins only — enforced via userInfo.getUserInfo() ownershipEntityRefs.
   */
  router.post('/projects', async (req, res) => {
    try {
      const credentials = await httpAuth.credentials(req as any, { allow: ['user'] });
      const info = await userInfo.getUserInfo(credentials);
      const userEntityRef = info.userEntityRef;
      const ownershipRefs = info.ownershipEntityRefs ?? [];

      const isAdmin = ownershipRefs.some(
        r => r === 'group:default/backstage-admins' || r === 'group:default/admins',
      );
      const isPM = ownershipRefs.some(
        r => r === 'group:default/pm-team',
      );
      if (!isAdmin && !isPM) {
        return res.status(403).json({ error: 'Only project managers and admins can create projects' });
      }

      const {
        name, description, client_name, start_date, end_date,
        aws_tag_project, aws_tag_client, aws_tag_team,
        pm_tool, jira_key, jira_template, team_name, team_members,
      } = req.body;

      if (!name || !client_name) {
        return res.status(400).json({ error: 'name and client_name are required' });
      }

      const project = await projectStore.createProject({
        name,
        description,
        client_name,
        aws_tag_project,
        aws_tag_client,
        aws_tag_team,
        start_date,
        end_date,
        pm_tool,
        jira_key,
        jira_template,
        team_name,
        team_members,
        created_by: userEntityRef,
      });

      logger.info(`Project created: ${project.id} "${project.name}" by ${userEntityRef}`);
      return res.status(201).json(project);
    } catch (err: any) {
      if (err.name === 'AuthenticationError' || err.message?.includes('credentials')) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      logger.error('Failed to create project', { error: err.message });
      return res.status(500).json({ error: 'Failed to create project' });
    }
  });

  /**
   * PATCH /projects/:id
   * Update mutable project fields.
   * Leads and admins only.
   */
  router.patch('/projects/:id', async (req, res) => {
    try {
      const credentials = await httpAuth.credentials(req as any, { allow: ['user'] });
      const info = await userInfo.getUserInfo(credentials);
      const ownershipRefs = info.ownershipEntityRefs ?? [];
      const isAdmin = ownershipRefs.some(r => r === 'group:default/backstage-admins' || r === 'group:default/admins');
      const isPM = ownershipRefs.some(r => r === 'group:default/pm-team');
      if (!isAdmin && !isPM) {
        return res.status(403).json({ error: 'Only project managers and admins can update projects' });
      }

      const { name, description, client_name, start_date, end_date, pm_tool, jira_key, jira_template, team_name, team_members } = req.body;
      const project = await projectStore.updateProject(req.params.id, {
        name, description, client_name, start_date, end_date, pm_tool, jira_key, jira_template, team_name, team_members,
      });
      return res.json(project);
    } catch (err: any) {
      if (err.name === 'AuthenticationError' || err.message?.includes('credentials')) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      if (err.message?.includes('not found')) return res.status(404).json({ error: err.message });
      logger.error('Failed to update project', { error: err.message });
      return res.status(500).json({ error: 'Failed to update project' });
    }
  });

  /**
   * POST /projects/:id/unarchive
   * Restore an archived project.
   * Leads and admins only.
   */
  router.post('/projects/:id/unarchive', async (req, res) => {
    try {
      const credentials = await httpAuth.credentials(req as any, { allow: ['user'] });
      const info = await userInfo.getUserInfo(credentials);
      const ownershipRefs = info.ownershipEntityRefs ?? [];
      const isAdmin = ownershipRefs.some(r => r === 'group:default/backstage-admins' || r === 'group:default/admins');
      const isPM = ownershipRefs.some(r => r === 'group:default/pm-team');
      if (!isAdmin && !isPM) {
        return res.status(403).json({ error: 'Only project managers and admins can unarchive projects' });
      }
      await projectStore.unarchiveProject(req.params.id);
      return res.json({ message: 'Project restored successfully' });
    } catch (err: any) {
      if (err.name === 'AuthenticationError' || err.message?.includes('credentials')) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      if (err.message?.includes('not found')) return res.status(404).json({ error: err.message });
      logger.error('Failed to unarchive project', { error: err.message });
      return res.status(500).json({ error: 'Failed to unarchive project' });
    }
  });

  /**
   * DELETE /projects/:id
   * Hard delete a project. System projects cannot be deleted.
   * Admins only.
   */
  router.delete('/projects/:id', async (req, res) => {
    try {
      const credentials = await httpAuth.credentials(req as any, { allow: ['user'] });
      const info = await userInfo.getUserInfo(credentials);
      const ownershipRefs = info.ownershipEntityRefs ?? [];
      const isAdmin = ownershipRefs.some(r => r === 'group:default/backstage-admins' || r === 'group:default/admins');
      if (!isAdmin) {
        return res.status(403).json({ error: 'Only admins can delete projects' });
      }
      await projectStore.deleteProject(req.params.id);
      logger.info(`Project deleted: ${req.params.id}`);
      return res.status(204).send();
    } catch (err: any) {
      if (err.name === 'AuthenticationError' || err.message?.includes('credentials')) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      if (err.message?.includes('not found')) return res.status(404).json({ error: err.message });
      if (err.message?.includes('System projects')) return res.status(403).json({ error: err.message });
      logger.error('Failed to delete project', { error: err.message });
      return res.status(500).json({ error: 'Failed to delete project' });
    }
  });

  /**
   * POST /projects/:id/archive
   * Archive a project (soft delete). System projects cannot be archived.
   * Leads and admins only.
   */
  router.post('/projects/:id/archive', async (req, res) => {
    try {
      const credentials = await httpAuth.credentials(req as any, { allow: ['user'] });
      const info = await userInfo.getUserInfo(credentials);
      const ownershipRefs = info.ownershipEntityRefs ?? [];

      const isAdmin = ownershipRefs.some(
        r => r === 'group:default/backstage-admins' || r === 'group:default/admins',
      );
      const isPM = ownershipRefs.some(
        r => r === 'group:default/pm-team',
      );
      if (!isAdmin && !isPM) {
        return res.status(403).json({ error: 'Only project managers and admins can archive projects' });
      }

      await projectStore.archiveProject(req.params.id);
      return res.json({ message: 'Project archived successfully' });
    } catch (err: any) {
      if (err.name === 'AuthenticationError' || err.message?.includes('credentials')) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      if (err.message?.includes('not found')) {
        return res.status(404).json({ error: err.message });
      }
      if (err.message?.includes('System projects')) {
        return res.status(403).json({ error: err.message });
      }
      logger.error('Failed to archive project', { error: err.message });
      return res.status(500).json({ error: 'Failed to archive project' });
    }
  });

  return router;
}
