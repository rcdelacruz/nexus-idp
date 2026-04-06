import React, { useState, useEffect, useCallback } from 'react';
import {
  Content,
  Header,
  Page,
  ErrorBoundary,
  Table as BackstageTable,
  TableColumn,
} from '@backstage/core-components';
import { useApi, fetchApiRef, discoveryApiRef, identityApiRef } from '@backstage/core-plugin-api';
import { UserPickerField, CatalogUser } from './UserPickerField';
import {
  Box,
  Grid,
  Button,
  TextField,
  MenuItem,
  Typography,
  IconButton,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Switch,
  FormControlLabel,
} from '@material-ui/core';
import { Alert } from '@material-ui/lab';
import {
  Pencil, Trash2, Archive, ArchiveRestore,
  Minus, UserPlus, Loader, AlertTriangle,
} from 'lucide-react';
import { useColors, semantic } from '@stratpoint/theme-utils';

interface TeamMember {
  fullName: string;
  email: string;
  role: string;
  accessLevel: string;
}

interface Project {
  id: string;
  name: string;
  description?: string;
  client_name: string;
  type: 'client' | 'system';
  status: 'active' | 'archived';
  pm_tool?: string;
  jira_key?: string;
  jira_template?: string;
  team_name?: string;
  team_members?: TeamMember[];
  start_date?: string;
  end_date?: string;
  created_by: string;
  created_at: string;
}

interface EditForm {
  name: string;
  description: string;
  client_name: string;
  team_name: string;
  pm_tool: string;
  jira_key: string;
  jira_template: string;
  start_date: string;
  end_date: string;
}

export const ProjectListPage = () => {
  const fetchApi = useApi(fetchApiRef);
  const discoveryApi = useApi(discoveryApiRef);
  const identityApi = useApi(identityApiRef);
  const c = useColors();

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  // Edit dialog state
  const [editOpen, setEditOpen] = useState(false);
  const [editProject, setEditProject] = useState<Project | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({
    name: '', description: '', client_name: '', team_name: '',
    pm_tool: 'none', jira_key: '', jira_template: 'scrum', start_date: '', end_date: '',
  });
  const [editMembers, setEditMembers] = useState<TeamMember[]>([]);
  const [editSelectedUsers, setEditSelectedUsers] = useState<(CatalogUser | null)[]>([]);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Delete confirm dialog state
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Action feedback
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  // ── Styles ──────────────────────────────────────────────────────────────────

  const sectionLabel: React.CSSProperties = {
    fontSize: '0.6875rem',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: c.textMuted,
  };

  // ── Data fetching ───────────────────────────────────────────────────────────

  useEffect(() => {
    identityApi.getBackstageIdentity().then(identity => {
      setIsAdmin(identity.ownershipEntityRefs.some(r => r === 'group:default/backstage-admins'));
    }).catch(() => {});
  }, [identityApi]);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const baseUrl = await discoveryApi.getBaseUrl('project-registration');
      const res = await fetchApi.fetch(`${baseUrl}/projects?includeArchived=${showArchived}`);
      if (!res.ok) throw new Error(`Failed to load projects (${res.status})`);
      const data = await res.json();
      setProjects(data.projects ?? []);
    } catch (err: any) {
      setError(err.message || 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, [discoveryApi, fetchApi, showArchived]);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  // ── Edit handlers ───────────────────────────────────────────────────────────

  const openEdit = (project: Project) => {
    setEditProject(project);
    setEditForm({
      name: project.name,
      description: project.description ?? '',
      client_name: project.client_name,
      team_name: project.team_name ?? '',
      pm_tool: project.pm_tool ?? 'none',
      jira_key: project.jira_key ?? '',
      jira_template: project.jira_template ?? 'scrum',
      start_date: project.start_date ?? '',
      end_date: project.end_date ?? '',
    });
    const members = project.team_members && project.team_members.length > 0
      ? project.team_members
      : [{ fullName: '', email: '', role: '', accessLevel: 'member' }];
    setEditMembers(members);
    setEditSelectedUsers(members.map(m =>
      m.fullName || m.email
        ? { entityRef: '', displayName: m.fullName, email: m.email }
        : null,
    ));
    setEditError(null);
    setEditOpen(true);
  };

  const handleEditChange = (field: keyof EditForm) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditForm(f => ({ ...f, [field]: e.target.value }));
  };

  const handleMemberChange = (index: number, field: keyof TeamMember) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditMembers(members => {
      const updated = [...members];
      updated[index] = { ...updated[index], [field]: e.target.value };
      return updated;
    });
  };

  const handleEditUserSelect = (index: number, user: CatalogUser | null) => {
    setEditSelectedUsers(prev => { const u = [...prev]; u[index] = user; return u; });
    setEditMembers(prev => {
      const m = [...prev];
      m[index] = { ...m[index], fullName: user?.displayName ?? '', email: user?.email ?? '' };
      return m;
    });
  };

  const addMember = () => {
    setEditMembers(m => [...m, { fullName: '', email: '', role: '', accessLevel: 'member' }]);
    setEditSelectedUsers(u => [...u, null]);
  };
  const removeMember = (index: number) => {
    setEditMembers(m => m.filter((_, i) => i !== index));
    setEditSelectedUsers(u => u.filter((_, i) => i !== index));
  };

  const handleEditSave = async () => {
    if (!editProject) return;
    setEditLoading(true);
    setEditError(null);
    try {
      const baseUrl = await discoveryApi.getBaseUrl('project-registration');
      const res = await fetchApi.fetch(`${baseUrl}/projects/${editProject.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editForm.name,
          description: editForm.description || undefined,
          client_name: editForm.client_name,
          team_name: editForm.team_name || undefined,
          pm_tool: editForm.pm_tool !== 'none' ? editForm.pm_tool : undefined,
          jira_key: editForm.pm_tool === 'jira' ? editForm.jira_key || undefined : undefined,
          jira_template: editForm.pm_tool === 'jira' ? editForm.jira_template || undefined : undefined,
          start_date: editForm.start_date || undefined,
          end_date: editForm.end_date || undefined,
          team_members: editMembers.filter(m => m.fullName || m.email),
        }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      setEditOpen(false);
      setActionMsg('Project updated successfully');
      fetchProjects();
    } catch (err: any) {
      setEditError(err.message || 'Failed to update project');
    } finally {
      setEditLoading(false);
    }
  };

  // ── Archive / Delete handlers ───────────────────────────────────────────────

  const handleArchiveToggle = async (project: Project) => {
    const action = project.status === 'active' ? 'archive' : 'unarchive';
    try {
      const baseUrl = await discoveryApi.getBaseUrl('project-registration');
      const res = await fetchApi.fetch(`${baseUrl}/projects/${project.id}/${action}`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      setActionMsg(action === 'archive' ? 'Project archived' : 'Project restored');
      fetchProjects();
    } catch (err: any) {
      setError(err.message || `Failed to ${action} project`);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      const baseUrl = await discoveryApi.getBaseUrl('project-registration');
      const res = await fetchApi.fetch(`${baseUrl}/projects/${deleteId}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      setDeleteId(null);
      setActionMsg('Project deleted');
      fetchProjects();
    } catch (err: any) {
      setDeleteError(err.message || 'Failed to delete project');
    } finally {
      setDeleteLoading(false);
    }
  };

  const formatDate = (d?: string) => d ? new Date(d).toLocaleDateString() : '—';

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <ErrorBoundary>
      <Page themeId="tool">
        <Header title="Manage Projects" subtitle="Edit, archive, or delete projects">
          <FormControlLabel
            control={<Switch checked={showArchived} color="primary" />}
            label="Show archived"
            onChange={(_e, checked) => { setShowArchived(checked); }}
          />
        </Header>
        <Content>
          {actionMsg && (
            <Alert severity="success" onClose={() => setActionMsg(null)} style={{ marginBottom: 16 }}>
              {actionMsg}
            </Alert>
          )}
          {error && (
            <Alert severity="error" onClose={() => setError(null)} style={{ marginBottom: 16 }}>
              {error}
            </Alert>
          )}

          <BackstageTable<Project>
            title={`${projects.length} ${showArchived ? 'total' : 'active'} project${projects.length !== 1 ? 's' : ''}`}
            data={projects}
            isLoading={loading}
            options={{
              search: true,
              paging: true,
              pageSize: 10,
              pageSizeOptions: [10, 25, 50],
              padding: 'dense',
              actionsColumnIndex: -1,
            }}
            columns={[
              {
                title: 'Name',
                field: 'name',
                render: (p: Project) => (
                  <Box>
                    <Typography style={{ fontSize: '0.875rem', fontWeight: 500 }}>{p.name}</Typography>
                    {p.description && (
                      <Typography style={{ fontSize: '0.75rem', color: c.textMuted }}>{p.description}</Typography>
                    )}
                  </Box>
                ),
              },
              { title: 'Client', field: 'client_name' },
              { title: 'Team', field: 'team_name', render: (p: Project) => p.team_name ?? '—' },
              {
                title: 'PM Tool',
                field: 'pm_tool',
                render: (p: Project) => p.pm_tool ? <Chip label={p.pm_tool} size="small" /> : '—',
              },
              { title: 'Start', field: 'start_date', render: (p: Project) => formatDate(p.start_date) },
              { title: 'End', field: 'end_date', render: (p: Project) => formatDate(p.end_date) },
              {
                title: 'Status',
                field: 'status',
                render: (p: Project) => (
                  <Box>
                    <Chip label={p.status} size="small" color={p.status === 'active' ? 'primary' : 'default'} />
                    {p.type === 'system' && <Chip label="system" size="small" style={{ marginLeft: 4 }} />}
                  </Box>
                ),
              },
              {
                title: 'Created By',
                field: 'created_by',
                render: (p: Project) => (
                  <Typography style={{ fontSize: '0.75rem', color: c.textMuted }}>
                    {p.created_by.replace('user:default/', '')}
                  </Typography>
                ),
              },
              {
                title: 'Actions',
                field: 'id',
                sorting: false,
                searchable: false,
                width: '120px',
                render: (p: Project) => (
                  <Box display="flex" style={{ gap: 4 }} justifyContent="flex-end" alignItems="center">
                    {p.type !== 'system' && (
                      <IconButton size="small" title="Edit" onClick={() => openEdit(p)} aria-label="Edit">
                        <Pencil size={16} strokeWidth={1.5} />
                      </IconButton>
                    )}
                    {p.type !== 'system' && (
                      <IconButton
                        size="small"
                        title={p.status === 'active' ? 'Archive' : 'Restore'}
                        onClick={() => handleArchiveToggle(p)}
                        aria-label={p.status === 'active' ? 'Archive' : 'Restore'}
                      >
                        {p.status === 'active'
                          ? <Archive size={16} strokeWidth={1.5} />
                          : <ArchiveRestore size={16} strokeWidth={1.5} />
                        }
                      </IconButton>
                    )}
                    {isAdmin && p.type !== 'system' && (
                      <IconButton size="small" title="Delete" onClick={() => { setDeleteId(p.id); setDeleteError(null); }} aria-label="Delete">
                        <Trash2 size={16} strokeWidth={1.5} />
                      </IconButton>
                    )}
                  </Box>
                ),
              },
            ] as TableColumn<Project>[]}
          />

          {/* Edit Dialog */}
          <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="sm" fullWidth>
            <DialogTitle>Edit Project</DialogTitle>
            <DialogContent>
              {editError && <Alert severity="error" style={{ marginBottom: 16 }}>{editError}</Alert>}

              <Typography style={{ ...sectionLabel, marginTop: 8, marginBottom: 12 }}>Project Details</Typography>
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <TextField
                    required fullWidth variant="outlined" size="small"
                    label="Project Name"
                    value={editForm.name}
                    onChange={handleEditChange('name')}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    fullWidth multiline minRows={3} variant="outlined" size="small"
                    label="Description"
                    value={editForm.description}
                    onChange={handleEditChange('description')}
                    InputProps={{ style: { height: 'auto' } }}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    required fullWidth variant="outlined" size="small"
                    label="Client Name"
                    value={editForm.client_name}
                    onChange={handleEditChange('client_name')}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    fullWidth select variant="outlined" size="small"
                    label="Assigned Team"
                    value={editForm.team_name}
                    onChange={handleEditChange('team_name')}
                  >
                    <MenuItem value="">None</MenuItem>
                    <MenuItem value="web-team">Web</MenuItem>
                    <MenuItem value="mobile-team">Mobile</MenuItem>
                    <MenuItem value="data-team">Data</MenuItem>
                    <MenuItem value="cloud-team">Cloud</MenuItem>
                    <MenuItem value="ai-team">AI</MenuItem>
                    <MenuItem value="qa-team">QA</MenuItem>
                    <MenuItem value="sa-team">SolArch</MenuItem>
                  </TextField>
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    fullWidth type="date" variant="outlined" size="small"
                    label="Start Date"
                    InputLabelProps={{ shrink: true }}
                    value={editForm.start_date}
                    onChange={handleEditChange('start_date')}
                  />
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    fullWidth type="date" variant="outlined" size="small"
                    label="End Date"
                    InputLabelProps={{ shrink: true }}
                    value={editForm.end_date}
                    onChange={handleEditChange('end_date')}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    fullWidth select variant="outlined" size="small"
                    label="PM Tool"
                    value={editForm.pm_tool}
                    onChange={handleEditChange('pm_tool')}
                  >
                    <MenuItem value="none">None</MenuItem>
                    <MenuItem value="jira">Jira</MenuItem>
                    <MenuItem value="github">GitHub Projects</MenuItem>
                  </TextField>
                </Grid>
                {editForm.pm_tool === 'jira' && (
                  <>
                    <Grid item xs={6}>
                      <TextField
                        fullWidth variant="outlined" size="small"
                        label="Jira Project Key"
                        value={editForm.jira_key}
                        onChange={handleEditChange('jira_key')}
                      />
                    </Grid>
                    <Grid item xs={6}>
                      <TextField
                        fullWidth select variant="outlined" size="small"
                        label="Jira Template"
                        value={editForm.jira_template}
                        onChange={handleEditChange('jira_template')}
                      >
                        <MenuItem value="scrum">Scrum</MenuItem>
                        <MenuItem value="kanban">Kanban</MenuItem>
                        <MenuItem value="basic">Basic</MenuItem>
                      </TextField>
                    </Grid>
                  </>
                )}
              </Grid>

              {/* Team Members — same pattern as ProjectRegistrationPage */}
              <Typography style={{ ...sectionLabel, marginTop: 24, marginBottom: 12 }}>Team Members</Typography>

              {editMembers.map((member, idx) => (
                <Box
                  key={idx}
                  style={{
                    background: c.surfaceSubtle,
                    border: `1px solid ${c.border}`,
                    borderRadius: 8,
                    padding: 16,
                    marginBottom: 10,
                  }}
                >
                  <Box display="flex" justifyContent="space-between" alignItems="center" style={{ marginBottom: 10 }}>
                    <Typography style={{ fontSize: '0.75rem', color: c.textMuted }}>
                      Member {idx + 1}
                    </Typography>
                    {editMembers.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeMember(idx)}
                        aria-label={`Remove member ${idx + 1}`}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                          background: 'transparent', border: `1px solid ${c.border}`,
                          color: c.textMuted, fontSize: '0.75rem', fontWeight: 500,
                        }}
                      >
                        <Minus size={12} strokeWidth={1.5} aria-hidden="true" />
                        Remove
                      </button>
                    )}
                  </Box>
                  <Grid container spacing={1}>
                    <Grid item xs={12}>
                      <UserPickerField
                        label="Select User"
                        size="small"
                        value={editSelectedUsers[idx] ?? null}
                        onChange={user => handleEditUserSelect(idx, user)}
                      />
                    </Grid>
                    <Grid item xs={6}>
                      <TextField
                        fullWidth select variant="outlined" size="small"
                        label="Role"
                        value={member.role}
                        onChange={handleMemberChange(idx, 'role')}
                      >
                        <MenuItem value="developer">Developer</MenuItem>
                        <MenuItem value="tech-lead">Tech Lead</MenuItem>
                        <MenuItem value="product-manager">Product Manager</MenuItem>
                        <MenuItem value="designer">Designer</MenuItem>
                      </TextField>
                    </Grid>
                    <Grid item xs={6}>
                      <TextField
                        fullWidth select variant="outlined" size="small"
                        label="Access Level"
                        value={member.accessLevel}
                        onChange={handleMemberChange(idx, 'accessLevel')}
                      >
                        <MenuItem value="member">Team Member</MenuItem>
                        <MenuItem value="lead">Team Lead</MenuItem>
                        <MenuItem value="admin">Admin</MenuItem>
                      </TextField>
                    </Grid>
                  </Grid>
                </Box>
              ))}

              <button
                type="button"
                onClick={addMember}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 4,
                  padding: '8px 14px', borderRadius: 6, cursor: 'pointer',
                  background: 'transparent', border: `1px solid ${c.border}`,
                  color: c.textSecondary, fontSize: '0.8125rem', fontWeight: 500,
                }}
              >
                <UserPlus size={14} strokeWidth={1.5} aria-hidden="true" />
                Add Team Member
              </button>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setEditOpen(false)} disabled={editLoading}>
                Cancel
              </Button>
              <Button
                variant="contained" color="primary"
                onClick={handleEditSave}
                disabled={editLoading || !editForm.name || !editForm.client_name}
                startIcon={editLoading ? <Loader size={14} strokeWidth={1.5} /> : undefined}
              >
                {editLoading ? 'Saving...' : 'Save'}
              </Button>
            </DialogActions>
          </Dialog>

          {/* Delete Confirm Dialog */}
          <Dialog open={Boolean(deleteId)} onClose={() => setDeleteId(null)} maxWidth="xs" fullWidth>
            <DialogTitle>Delete Project?</DialogTitle>
            <DialogContent>
              {deleteError && <Alert severity="error" style={{ marginBottom: 16 }}>{deleteError}</Alert>}
              <Box display="flex" style={{ gap: 12 }} alignItems="flex-start">
                <AlertTriangle size={18} color={semantic.error} strokeWidth={1.5} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
                <Typography style={{ fontSize: '0.875rem', color: c.text }}>
                  This will permanently delete the project and cannot be undone.
                  Consider archiving instead to preserve the record.
                </Typography>
              </Box>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDeleteId(null)} disabled={deleteLoading}>
                Cancel
              </Button>
              <Button
                variant="contained"
                onClick={handleDelete}
                disabled={deleteLoading}
                startIcon={deleteLoading ? <Loader size={14} strokeWidth={1.5} /> : undefined}
                style={{
                  backgroundColor: '#e5484d',
                  color: '#ffffff',
                }}
              >
                {deleteLoading ? 'Deleting...' : 'Delete'}
              </Button>
            </DialogActions>
          </Dialog>

        </Content>
      </Page>
    </ErrorBoundary>
  );
};

export default ProjectListPage;
