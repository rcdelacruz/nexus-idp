import React, { useState, useEffect, useCallback } from 'react';
import {
  Content,
  Header,
  Page,
  ErrorBoundary,
  Progress,
} from '@backstage/core-components';
import { useApi, fetchApiRef, discoveryApiRef, identityApiRef } from '@backstage/core-plugin-api';
import { UserPickerField, CatalogUser } from './UserPickerField';
import {
  Grid,
  Button,
  TextField,
  MenuItem,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Switch,
  FormControlLabel,
  Divider,
  TablePagination,
  makeStyles,
} from '@material-ui/core';
import { Alert } from '@material-ui/lab';
import EditIcon from '@material-ui/icons/Edit';
import DeleteIcon from '@material-ui/icons/Delete';
import ArchiveIcon from '@material-ui/icons/Archive';
import UnarchiveIcon from '@material-ui/icons/Unarchive';
import AddIcon from '@material-ui/icons/Add';
import RemoveIcon from '@material-ui/icons/Remove';

const useStyles = makeStyles(theme => ({
  tableContainer: {
    marginTop: theme.spacing(2),
  },
  chip: {
    fontSize: '0.75rem',
  },
  actions: {
    display: 'flex',
    gap: theme.spacing(0.5),
    alignItems: 'center',
  },
  dialogField: {
    marginBottom: theme.spacing(2),
  },
  toolbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing(2),
  },
  memberRow: {
    padding: theme.spacing(1.5),
    marginBottom: theme.spacing(1),
    background: theme.palette.background.default,
    borderRadius: 4,
    border: `1px solid ${theme.palette.divider}`,
  },
  memberHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing(1),
  },
}));

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
  const classes = useStyles();
  const fetchApi = useApi(fetchApiRef);
  const discoveryApi = useApi(discoveryApiRef);
  const identityApi = useApi(identityApiRef);

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const PAGE_SIZE_OPTIONS = [10, 25, 50];

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
    // Pre-populate selected users from saved fullName/email so picker shows the right value
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

  return (
    <ErrorBoundary>
      <Page themeId="tool">
        <Header title="Manage Projects" subtitle="Edit, archive, or delete projects" />
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

          <div className={classes.toolbar}>
            <Typography variant="h6">
              {projects.length} {showArchived ? 'total' : 'active'} project{projects.length !== 1 ? 's' : ''}
            </Typography>
            <FormControlLabel
              control={<Switch checked={showArchived} color="primary" />}
              label="Show archived"
              onChange={(_e, checked) => { setShowArchived(checked); setPage(0); }}
            />
          </div>

          {loading ? (
            <Progress />
          ) : (
            <TableContainer component={Paper} className={classes.tableContainer}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Client</TableCell>
                    <TableCell>Team</TableCell>
                    <TableCell>PM Tool</TableCell>
                    <TableCell>Start</TableCell>
                    <TableCell>End</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Created By</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {projects.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} align="center">
                        <Typography color="textSecondary">No projects found</Typography>
                      </TableCell>
                    </TableRow>
                  ) : projects.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage).map(p => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <Typography variant="body2" style={{ fontWeight: 500 }}>{p.name}</Typography>
                        {p.description && (
                          <Typography variant="caption" color="textSecondary">{p.description}</Typography>
                        )}
                      </TableCell>
                      <TableCell>{p.client_name}</TableCell>
                      <TableCell>{p.team_name ?? '—'}</TableCell>
                      <TableCell>
                        {p.pm_tool ? (
                          <Chip label={p.pm_tool} size="small" className={classes.chip} />
                        ) : '—'}
                      </TableCell>
                      <TableCell>{formatDate(p.start_date)}</TableCell>
                      <TableCell>{formatDate(p.end_date)}</TableCell>
                      <TableCell>
                        <Chip
                          label={p.status}
                          size="small"
                          className={classes.chip}
                          color={p.status === 'active' ? 'primary' : 'default'}
                        />
                        {p.type === 'system' && (
                          <Chip label="system" size="small" className={classes.chip} style={{ marginLeft: 4 }} />
                        )}
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption">{p.created_by.replace('user:default/', '')}</Typography>
                      </TableCell>
                      <TableCell align="right">
                        <div className={classes.actions}>
                          {p.type !== 'system' && (
                            <IconButton size="small" title="Edit" onClick={() => openEdit(p)}>
                              <EditIcon fontSize="small" />
                            </IconButton>
                          )}
                          {p.type !== 'system' && (
                            <IconButton
                              size="small"
                              title={p.status === 'active' ? 'Archive' : 'Restore'}
                              onClick={() => handleArchiveToggle(p)}
                            >
                              {p.status === 'active'
                                ? <ArchiveIcon fontSize="small" />
                                : <UnarchiveIcon fontSize="small" />
                              }
                            </IconButton>
                          )}
                          {isAdmin && p.type !== 'system' && (
                            <IconButton size="small" title="Delete" onClick={() => { setDeleteId(p.id); setDeleteError(null); }}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <TablePagination
                component="div"
                count={projects.length}
                page={page}
                onPageChange={(_e, newPage) => setPage(newPage)}
                rowsPerPage={rowsPerPage}
                onRowsPerPageChange={e => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
                rowsPerPageOptions={PAGE_SIZE_OPTIONS}
              />
            </TableContainer>
          )}

          {/* Edit Dialog */}
          <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="sm" fullWidth>
            <DialogTitle>Edit Project</DialogTitle>
            <DialogContent>
              {editError && <Alert severity="error" style={{ marginBottom: 16 }}>{editError}</Alert>}
              <Grid container spacing={2} style={{ marginTop: 4 }}>
                <Grid item xs={12}>
                  <TextField
                    required fullWidth label="Project Name"
                    value={editForm.name}
                    onChange={handleEditChange('name')}
                    className={classes.dialogField}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    fullWidth multiline rows={3} label="Description"
                    value={editForm.description}
                    onChange={handleEditChange('description')}
                    className={classes.dialogField}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    required fullWidth label="Client Name"
                    value={editForm.client_name}
                    onChange={handleEditChange('client_name')}
                    className={classes.dialogField}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    fullWidth label="Team Name"
                    value={editForm.team_name}
                    onChange={handleEditChange('team_name')}
                    className={classes.dialogField}
                  />
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    fullWidth type="date" label="Start Date"
                    InputLabelProps={{ shrink: true }}
                    value={editForm.start_date}
                    onChange={handleEditChange('start_date')}
                    className={classes.dialogField}
                  />
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    fullWidth type="date" label="End Date"
                    InputLabelProps={{ shrink: true }}
                    value={editForm.end_date}
                    onChange={handleEditChange('end_date')}
                    className={classes.dialogField}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    fullWidth select label="PM Tool"
                    value={editForm.pm_tool}
                    onChange={handleEditChange('pm_tool')}
                    className={classes.dialogField}
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
                        fullWidth label="Jira Project Key"
                        value={editForm.jira_key}
                        onChange={handleEditChange('jira_key')}
                        className={classes.dialogField}
                      />
                    </Grid>
                    <Grid item xs={6}>
                      <TextField
                        fullWidth select label="Jira Template"
                        value={editForm.jira_template}
                        onChange={handleEditChange('jira_template')}
                        className={classes.dialogField}
                      >
                        <MenuItem value="scrum">Scrum</MenuItem>
                        <MenuItem value="kanban">Kanban</MenuItem>
                        <MenuItem value="basic">Basic</MenuItem>
                      </TextField>
                    </Grid>
                  </>
                )}

                {/* Team Members */}
                <Grid item xs={12}>
                  <Divider style={{ margin: '8px 0 16px' }} />
                  <Typography variant="subtitle2" style={{ marginBottom: 8 }}>Team Members</Typography>
                  {editMembers.map((member, idx) => (
                    <div key={idx} className={classes.memberRow}>
                      <div className={classes.memberHeader}>
                        <Typography variant="caption" color="textSecondary">Member {idx + 1}</Typography>
                        {editMembers.length > 1 && (
                          <IconButton size="small" onClick={() => removeMember(idx)}>
                            <RemoveIcon fontSize="small" />
                          </IconButton>
                        )}
                      </div>
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
                            fullWidth size="small" select label="Role"
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
                            fullWidth size="small" select label="Access Level"
                            value={member.accessLevel}
                            onChange={handleMemberChange(idx, 'accessLevel')}
                          >
                            <MenuItem value="member">Team Member</MenuItem>
                            <MenuItem value="lead">Team Lead</MenuItem>
                            <MenuItem value="admin">Admin</MenuItem>
                          </TextField>
                        </Grid>
                      </Grid>
                    </div>
                  ))}
                  <Button
                    variant="outlined" size="small" startIcon={<AddIcon />}
                    onClick={addMember}
                    style={{ marginTop: 4 }}
                  >
                    Add Member
                  </Button>
                </Grid>
              </Grid>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setEditOpen(false)} disabled={editLoading}>Cancel</Button>
              <Button
                variant="contained" color="primary"
                onClick={handleEditSave}
                disabled={editLoading || !editForm.name || !editForm.client_name}
              >
                {editLoading ? 'Saving…' : 'Save'}
              </Button>
            </DialogActions>
          </Dialog>

          {/* Delete Confirm Dialog */}
          <Dialog open={Boolean(deleteId)} onClose={() => setDeleteId(null)} maxWidth="xs" fullWidth>
            <DialogTitle>Delete Project?</DialogTitle>
            <DialogContent>
              {deleteError && <Alert severity="error" style={{ marginBottom: 16 }}>{deleteError}</Alert>}
              <Typography>
                This will permanently delete the project and cannot be undone.
                Consider archiving instead to preserve the record.
              </Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDeleteId(null)} disabled={deleteLoading}>Cancel</Button>
              <Button
                variant="contained" color="secondary"
                onClick={handleDelete}
                disabled={deleteLoading}
              >
                {deleteLoading ? 'Deleting…' : 'Delete'}
              </Button>
            </DialogActions>
          </Dialog>

        </Content>
      </Page>
    </ErrorBoundary>
  );
};

export default ProjectListPage;
