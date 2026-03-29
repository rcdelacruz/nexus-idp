import React, { useEffect, useState } from 'react';
import { useApi, identityApiRef } from '@backstage/core-plugin-api';
import { Page, Header, Content } from '@backstage/core-components';
import {
  Box, Checkbox, CircularProgress, Dialog, DialogContent, DialogTitle,
  FormControlLabel, FormGroup, IconButton, Table, TableBody,
  TableCell, TableHead, TableRow, Typography,
} from '@material-ui/core';
import {
  AlertCircle, Check, Loader, Shield, UserCheck, UserX, X, Info, ShieldCheck, Trash2,
} from 'lucide-react';
import { useColors, semantic, badge } from '@stratpoint/theme-utils';
import { userManagementApiRef } from '../api/refs';

// ── Constants ─────────────────────────────────────────────────────────────────

const DEPT_TEAMS = ['web-team', 'mobile-team', 'data-team', 'cloud-team', 'ai-team', 'qa-team'];

const TEAM_LABELS: Record<string, string> = {
  'web-team': 'Web',
  'mobile-team': 'Mobile',
  'data-team': 'Data',
  'cloud-team': 'Cloud',
  'ai-team': 'AI',
  'qa-team': 'QA',
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface UserRecord {
  entityRef: string;
  name: string;
  displayName: string;
  email: string;
  picture?: string;
  currentGroups: string[];
  deptTeams: string[];   // all assigned dept teams (multi-department supported)
  isLead: boolean;
  isAdmin: boolean;
  isUnassigned: boolean;
  githubLinked: boolean;
  onboardingCatalogTour: boolean;
  onboardingEngineeringDocs: boolean;
}

export interface AssignDialogProps {
  user: UserRecord;
  onClose: () => void;
  onAssigned: (teams: string[], isLead: boolean) => void;
}

// ── Assign Dialog ─────────────────────────────────────────────────────────────

const AssignDialog = ({ user, onClose, onAssigned }: AssignDialogProps) => {
  const api = useApi(userManagementApiRef);
  const c = useColors();
  const [selectedTeams, setSelectedTeams] = useState<string[]>(user.deptTeams);
  const [isLead, setIsLead] = useState(user.isLead);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const toggleTeam = (team: string) => {
    setSelectedTeams(prev =>
      prev.includes(team) ? prev.filter(t => t !== team) : [...prev, team],
    );
  };

  const btn = (primary = false) => ({
    display: 'inline-flex' as const,
    alignItems: 'center' as const,
    gap: 6,
    padding: '5px 12px',
    borderRadius: 6,
    fontSize: '0.8125rem',
    fontWeight: 500,
    cursor: 'pointer',
    border: `1px solid ${primary ? semantic.success : c.border}`,
    background: primary ? semantic.successBg : 'transparent',
    color: primary ? semantic.success : c.textSecondary,
  } as const);

  const assign = async () => {
    if (selectedTeams.length === 0) { setError('Select at least one team.'); return; }
    setLoading(true); setError('');
    try {
      const teamList = selectedTeams.join(', ');
      const res = await api.assign({
        userName: user.name,
        teams: selectedTeams,
        isLead,
        displayName: user.displayName,
      });
      onAssigned(selectedTeams, isLead);
      setSuccess(res.message ?? `${user.displayName} assigned to ${teamList}.`);
    } catch (err: any) {
      setError(err.message ?? 'Assignment failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="assign-dialog-title"
      data-loading={loading}
    >
      <DialogTitle
        id="assign-dialog-title"
        style={{ background: c.surface, borderBottom: `1px solid ${c.border}`, padding: '16px 20px' }}
      >
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Box display="flex" alignItems="center" style={{ gap: 8 }}>
            <UserCheck size={18} color={c.text} strokeWidth={1.5} aria-hidden="true" />
            <Typography style={{ fontSize: '0.9375rem', fontWeight: 600, color: c.text }}>
              Assign {user.displayName} to team(s)
            </Typography>
          </Box>
          <IconButton size="small" onClick={onClose} aria-label="Close dialog" style={{ color: c.textSecondary }}>
            <X size={16} strokeWidth={1.5} />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent style={{ background: c.surfaceSubtle, padding: 20 }}>
        {success ? (
          <Box
            display="flex" flexDirection="column" alignItems="center"
            style={{ padding: '24px 0', gap: 12 }}
            role="status" aria-live="polite"
          >
            <Check size={32} color={semantic.success} strokeWidth={2} aria-hidden="true" />
            <Typography style={{ color: semantic.success, fontSize: '0.9375rem', fontWeight: 600 }}>{success}</Typography>
            <Typography style={{ color: c.textMuted, fontSize: '0.8125rem' }}>
              The catalog will refresh within a minute.
            </Typography>
            <button onClick={onClose} style={{ ...btn(), marginTop: 8 }}>Close</button>
          </Box>
        ) : (
          <Box component="form" onSubmit={(e: React.FormEvent) => { e.preventDefault(); assign(); }}>
            <Box style={{ marginBottom: 20 }}>
              <Typography style={{ fontSize: '0.75rem', color: c.textMuted, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
                Current groups
              </Typography>
              <Box display="flex" style={{ gap: 6, flexWrap: 'wrap' }}>
                {user.currentGroups.length > 0
                  ? user.currentGroups.map(g => (
                      <span key={g} style={badge('gray-subtle')}>{g}</span>
                    ))
                  : <span style={badge('amber')}>unassigned</span>}
              </Box>
            </Box>

            <Box style={{ marginBottom: 16 }}>
              <Typography style={{ fontSize: '0.75rem', color: c.textMuted, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
                Department teams <span style={{ color: semantic.error }}>*</span>
              </Typography>
              <Typography style={{ fontSize: '0.75rem', color: c.textMuted, marginBottom: 10 }}>
                Engineers can belong to multiple departments. Access is the union of all selected teams.
              </Typography>
              <FormGroup>
                {DEPT_TEAMS.map(team => (
                  <FormControlLabel
                    key={team}
                    control={
                      <Checkbox
                        checked={selectedTeams.includes(team)}
                        onChange={() => toggleTeam(team)}
                        size="small"
                        style={{ color: selectedTeams.includes(team) ? semantic.success : c.textMuted, padding: '4px 8px' }}
                      />
                    }
                    label={
                      <Typography style={{ fontSize: '0.875rem', color: c.text }}>
                        {TEAM_LABELS[team] || team}
                      </Typography>
                    }
                    style={{ marginLeft: 0 }}
                  />
                ))}
              </FormGroup>
            </Box>

            {selectedTeams.length > 0 && (
              <Box style={{ marginBottom: 20 }}>
                <button
                  type="button"
                  onClick={() => setIsLead(v => !v)}
                  aria-pressed={isLead}
                  style={{ ...btn(isLead), padding: '4px 12px' }}
                >
                  <Shield size={13} strokeWidth={1.5} aria-hidden="true" />
                  {isLead ? 'Team Lead (in all selected teams)' : 'Make team lead'}
                </button>
              </Box>
            )}

            {error && (
              <Box id="assign-error" role="alert" display="flex" alignItems="center" style={{ gap: 6, marginBottom: 12 }}>
                <AlertCircle size={14} color={semantic.error} strokeWidth={1.5} aria-hidden="true" />
                <Typography style={{ color: semantic.error, fontSize: '0.8125rem' }}>{error}</Typography>
              </Box>
            )}

            <button
              type="submit"
              disabled={loading || selectedTeams.length === 0}
              aria-busy={loading}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                width: '100%', justifyContent: 'center', padding: '10px',
                borderRadius: 6, fontSize: '0.8125rem', fontWeight: 500,
                cursor: (selectedTeams.length === 0 || loading) ? 'not-allowed' : 'pointer',
                border: `1px solid ${semantic.success}`,
                background: semantic.successBg,
                color: semantic.success,
                opacity: (selectedTeams.length === 0 || loading) ? 0.5 : 1,
              }}
            >
              {loading
                ? <Loader size={14} strokeWidth={1.5} aria-hidden="true" />
                : <Check size={14} strokeWidth={2} aria-hidden="true" />}
              {loading
                ? 'Saving...'
                : selectedTeams.length === 0
                  ? 'Select at least one team'
                  : `Assign to ${selectedTeams.map(t => TEAM_LABELS[t] || t).join(', ')}`}
            </button>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
};

// ── Confirm Dialog (promote / delete) ─────────────────────────────────────────

interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

const ConfirmDialog = ({ title, body, confirmLabel, danger, onConfirm, onClose }: ConfirmDialogProps) => {
  const c = useColors();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleConfirm = async () => {
    setLoading(true); setError('');
    try {
      await onConfirm();
      setSuccess('Done.');
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  const confirmColor = danger ? semantic.error : semantic.success;
  const confirmBg = danger ? semantic.errorBg : semantic.successBg;

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth aria-labelledby="confirm-dialog-title">
      <DialogTitle
        id="confirm-dialog-title"
        style={{ background: c.surface, borderBottom: `1px solid ${c.border}`, padding: '16px 20px' }}
      >
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Typography style={{ fontSize: '0.9375rem', fontWeight: 600, color: c.text }}>{title}</Typography>
          <IconButton size="small" onClick={onClose} aria-label="Close dialog" style={{ color: c.textSecondary }}>
            <X size={16} strokeWidth={1.5} />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent style={{ background: c.surfaceSubtle, padding: 20 }}>
        {success ? (
          <Box display="flex" flexDirection="column" alignItems="center" style={{ padding: '16px 0', gap: 10 }} role="status">
            <Check size={28} color={semantic.success} strokeWidth={2} />
            <Typography style={{ color: semantic.success, fontWeight: 600 }}>{success}</Typography>
            <button onClick={onClose} style={{ padding: '5px 16px', borderRadius: 6, border: `1px solid ${c.border}`, background: 'transparent', color: c.textSecondary, cursor: 'pointer', fontSize: '0.8125rem' }}>Close</button>
          </Box>
        ) : (
          <>
            <Typography style={{ fontSize: '0.875rem', color: c.textSecondary, marginBottom: 20 }}>{body}</Typography>
            {error && (
              <Box display="flex" alignItems="center" style={{ gap: 6, marginBottom: 12 }} role="alert">
                <AlertCircle size={14} color={semantic.error} strokeWidth={1.5} />
                <Typography style={{ color: semantic.error, fontSize: '0.8125rem' }}>{error}</Typography>
              </Box>
            )}
            <Box display="flex" style={{ gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={{ padding: '6px 16px', borderRadius: 6, border: `1px solid ${c.border}`, background: 'transparent', color: c.textSecondary, cursor: 'pointer', fontSize: '0.8125rem' }}>
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={loading}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 16px', borderRadius: 6, border: `1px solid ${confirmColor}`, background: confirmBg, color: confirmColor, cursor: loading ? 'not-allowed' : 'pointer', fontSize: '0.8125rem', fontWeight: 500, opacity: loading ? 0.6 : 1 }}
              >
                {loading ? <Loader size={13} strokeWidth={1.5} /> : null}
                {loading ? 'Please wait...' : confirmLabel}
              </button>
            </Box>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

// ── Main Page ─────────────────────────────────────────────────────────────────

export const UserManagementPage = () => {
  const identityApi = useApi(identityApiRef);
  const api = useApi(userManagementApiRef);
  const c = useColors();

  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [currentUserName, setCurrentUserName] = useState('');
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null);
  const [promoteTarget, setPromoteTarget] = useState<UserRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserRecord | null>(null);

  useEffect(() => {
    identityApi.getBackstageIdentity().then(identity => {
      const refs = identity.ownershipEntityRefs ?? [];
      setIsAdmin(refs.some(r => r === 'group:default/backstage-admins'));
      setCurrentUserName(identity.userEntityRef.split('/').pop() ?? '');
    }).catch(() => setIsAdmin(false));
  }, [identityApi]);

  useEffect(() => {
    if (!isAdmin) return;
    setLoading(true);
    api.listUsers().then(rows => {
      const records: UserRecord[] = rows
        // Only show fully registered users: must have a dept team OR explicit DB admin flag.
        // Ghost rows (GitHub-only, no team, no admin) are artifacts and should not appear here.
        .filter(row => row.teams.some(g => DEPT_TEAMS.includes(g)) || row.is_admin)
        .map(row => {
          const hasDeptTeam = row.teams.some(g => DEPT_TEAMS.includes(g));
          const deptTeams = row.teams.filter((g: string) => DEPT_TEAMS.includes(g));
          const groups = [
            ...deptTeams,
            ...(row.is_lead ? deptTeams.map((t: string) => t.replace('-team', '-lead')) : []),
            ...(row.is_admin ? ['backstage-admins'] : []),
          ];
          return {
            entityRef: `user:default/${row.name}`,
            name: row.name,
            displayName: row.display_name,
            email: row.email,
            currentGroups: groups,
            deptTeams,
            isLead: row.is_lead,
            isAdmin: row.is_admin,
            isUnassigned: !hasDeptTeam && !row.is_admin,
            githubLinked: !!row.github_username,
            onboardingCatalogTour: row.onboarding_catalog_tour ?? false,
            onboardingEngineeringDocs: row.onboarding_engineering_docs ?? false,
          };
        });
      records.sort((a, b) => {
        if (a.isUnassigned && !b.isUnassigned) return -1;
        if (!a.isUnassigned && b.isUnassigned) return 1;
        return a.displayName.localeCompare(b.displayName);
      });
      setUsers(records);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [api, isAdmin]);

  if (isAdmin === false) {
    return (
      <Page themeId="tool">
        <Header title="User Management" />
        <Content>
          <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" style={{ minHeight: 300, gap: 12 }}>
            <Shield size={40} color={c.textMuted} strokeWidth={1.5} aria-hidden="true" />
            <Typography style={{ color: c.textSecondary, fontSize: '1rem', fontWeight: 600 }}>
              Admin access required
            </Typography>
            <Typography style={{ color: c.textMuted, fontSize: '0.875rem' }}>
              This page is only accessible to platform admins.
            </Typography>
          </Box>
        </Content>
      </Page>
    );
  }

  if (isAdmin === null) {
    return (
      <Page themeId="tool">
        <Header title="User Management" />
        <Content>
          <Box display="flex" justifyContent="center" mt={6}>
            <CircularProgress aria-label="Loading users" />
          </Box>
        </Content>
      </Page>
    );
  }

  const newUserCount = users.filter(u => u.isUnassigned).length;

  const card = { background: c.surface, border: `1px solid ${c.border}`, borderRadius: 8 } as const;


  const actionBtn = {
    display: 'inline-flex' as const, alignItems: 'center' as const,
    gap: 6, padding: '5px 12px', borderRadius: 6,
    fontSize: '0.8125rem', fontWeight: 500, cursor: 'pointer',
    border: `1px solid ${c.border}`, background: 'transparent', color: c.textSecondary,
  } as const;

  const headerCell = {
    color: c.textMuted, fontSize: '0.75rem', fontWeight: 600,
    letterSpacing: '0.06em', textTransform: 'uppercase' as const,
    borderBottom: `1px solid ${c.border}`, background: c.surface,
  };

  return (
    <Page themeId="tool">
      <Header title="User Management" subtitle={`${users.length} users · ${newUserCount} new`} />
      <Content>

        {/* Info banner */}
        <Box
          display="flex" alignItems="flex-start"
          style={{ ...card, padding: '12px 16px', marginBottom: 20, background: c.surfaceSubtle, gap: 8 }}
        >
          <Info size={16} color={c.textMuted} strokeWidth={1.5} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
          <Typography style={{ fontSize: '0.8125rem', color: c.textMuted }}>
            Users appear here after completing self-registration via the{' '}
            <strong style={{ color: c.textSecondary }}>Onboarding</strong> flow.
            Use <strong style={{ color: c.textSecondary }}>Assign team</strong> to move a user to a different department, or{' '}
            <strong style={{ color: c.textSecondary }}>Make admin</strong> to grant platform admin access.
          </Typography>
        </Box>

        {/* Table */}
        <Box component="section" aria-label="Users" style={card}>
          {loading ? (
            <Box display="flex" justifyContent="center" style={{ padding: 48 }}>
              <CircularProgress aria-label="Loading users" />
            </Box>
          ) : users.length === 0 ? (
            <Box display="flex" flexDirection="column" alignItems="center" style={{ padding: 48, gap: 8 }}>
              <UserCheck size={32} color={c.textMuted} strokeWidth={1.5} aria-hidden="true" />
              <Typography style={{ color: c.textSecondary }}>No users found.</Typography>
            </Box>
          ) : (
            <Table aria-label="User list">
              <TableHead>
                <TableRow>
                  <TableCell style={headerCell} scope="col">User</TableCell>
                  <TableCell style={headerCell} scope="col">Department</TableCell>
                  <TableCell style={headerCell} scope="col">Groups</TableCell>
                  <TableCell style={headerCell} scope="col">Onboarding</TableCell>
                  <TableCell style={headerCell} scope="col">Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {users.map(user => (
                  <TableRow key={user.entityRef} style={{ borderBottom: `1px solid ${c.border}` }} data-unassigned={user.isUnassigned}>
                    <TableCell style={{ borderBottom: 'none', padding: '12px 16px' }}>
                      <Box display="flex" alignItems="center" style={{ gap: 10 }}>
                        <Box
                          aria-hidden="true"
                          style={{
                            width: 32, height: 32, borderRadius: '50%',
                            background: c.avatarBg, border: `1px solid ${c.border}`,
                            flexShrink: 0, overflow: 'hidden',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}
                        >
                          {user.picture
                            ? <img src={user.picture} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            : <span style={{ fontSize: '0.75rem', color: c.textSecondary, fontWeight: 600 }}>
                                {user.displayName.charAt(0).toUpperCase()}
                              </span>
                          }
                        </Box>
                        <Box>
                          <Typography style={{ fontSize: '0.875rem', fontWeight: 500, color: c.text }}>
                            {user.displayName}
                          </Typography>
                          <Typography style={{ fontSize: '0.75rem', color: c.textSecondary }}>
                            {user.email}
                          </Typography>
                        </Box>
                      </Box>
                    </TableCell>

                    <TableCell style={{ borderBottom: 'none', padding: '12px 16px' }}>
                      {user.isAdmin
                        ? <span style={badge('purple')}>Admin</span>
                        : user.deptTeams.length > 0
                          ? <Box display="flex" style={{ gap: 4, flexWrap: 'wrap' }}>
                              {user.deptTeams.map(t => (
                                <span key={t} style={badge('blue-subtle')}>{TEAM_LABELS[t] || t}</span>
                              ))}
                            </Box>
                          : <span style={badge('amber')}>New user</span>
                      }
                    </TableCell>

                    <TableCell style={{ borderBottom: 'none', padding: '12px 16px', maxWidth: 200 }}>
                      <Box display="flex" style={{ gap: 4, flexWrap: 'wrap' }}>
                        {user.currentGroups.map(g => (
                          <span key={g} style={badge('gray')}>{g}</span>
                        ))}
                        {user.currentGroups.length === 0 && (
                          <span style={{ fontSize: '0.75rem', color: c.textMuted }}>—</span>
                        )}
                      </Box>
                    </TableCell>

                    <TableCell style={{ borderBottom: 'none', padding: '12px 16px' }}>
                      {(() => {
                        const steps = [
                          { label: 'Team', done: user.deptTeams.length > 0 || user.isAdmin },
                          { label: 'GitHub', done: user.githubLinked },
                          { label: 'Catalog', done: user.onboardingCatalogTour },
                          { label: 'Docs', done: user.onboardingEngineeringDocs },
                        ];
                        const completed = steps.filter(s => s.done).length;
                        return (
                          <Box display="flex" style={{ gap: 4, flexWrap: 'wrap' }}>
                            {steps.map(s => (
                              <span key={s.label} style={badge(s.done ? 'green' : 'gray')}>{s.label}</span>
                            ))}
                            <Typography style={{ fontSize: '0.6875rem', color: c.textMuted, marginLeft: 4 }}>
                              {completed}/{steps.length}
                            </Typography>
                          </Box>
                        );
                      })()}
                    </TableCell>

                    <TableCell style={{ borderBottom: 'none', padding: '12px 16px' }}>
                      <Box display="flex" style={{ gap: 6, flexWrap: 'wrap' }}>
                        {!user.isAdmin && (
                          <button
                            onClick={() => setSelectedUser(user)}
                            aria-label={`${user.isUnassigned ? 'Assign' : 'Reassign'} ${user.displayName} to a team`}
                            style={actionBtn}
                          >
                            <UserX size={13} strokeWidth={1.5} aria-hidden="true" />
                            {user.isUnassigned ? 'Assign team' : 'Reassign'}
                          </button>
                        )}
                        {user.name !== currentUserName && (
                          <button
                            onClick={() => setPromoteTarget(user)}
                            aria-label={user.isAdmin ? `Revoke admin from ${user.displayName}` : `Promote ${user.displayName} to admin`}
                            style={{ ...actionBtn, color: user.isAdmin ? semantic.warning : c.textSecondary, borderColor: user.isAdmin ? semantic.warning : c.border }}
                          >
                            <ShieldCheck size={13} strokeWidth={1.5} aria-hidden="true" />
                            {user.isAdmin ? 'Revoke admin' : 'Make admin'}
                          </button>
                        )}
                        {user.name !== currentUserName && (
                          <button
                            onClick={() => setDeleteTarget(user)}
                            aria-label={`Remove ${user.displayName}`}
                            style={{ ...actionBtn, color: semantic.error, borderColor: semantic.error }}
                          >
                            <Trash2 size={13} strokeWidth={1.5} aria-hidden="true" />
                            Remove
                          </button>
                        )}
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Box>

        {selectedUser && (
          <AssignDialog
            user={selectedUser}
            onClose={() => setSelectedUser(null)}
            onAssigned={(teams, lead) => {
              setUsers(prev => prev.map(u =>
                u.name === selectedUser.name
                  ? {
                      ...u,
                      deptTeams: teams,
                      isLead: lead,
                      isUnassigned: teams.length === 0 && !u.isAdmin,
                      currentGroups: [
                        ...teams,
                        ...(lead ? teams.map(t => t.replace('-team', '-lead')) : []),
                        ...(u.isAdmin ? ['backstage-admins'] : []),
                      ],
                    }
                  : u,
              ));
            }}
          />
        )}

        {promoteTarget && (
          <ConfirmDialog
            title={promoteTarget.isAdmin ? `Revoke admin — ${promoteTarget.displayName}` : `Make admin — ${promoteTarget.displayName}`}
            body={
              promoteTarget.isAdmin
                ? `${promoteTarget.displayName} will lose platform admin access. They will keep their current department team membership.`
                : `${promoteTarget.displayName} will gain full platform admin access, including FinOps and user management.`
            }
            confirmLabel={promoteTarget.isAdmin ? 'Revoke admin' : 'Make admin'}
            danger={promoteTarget.isAdmin}
            onConfirm={async () => {
              await api.promote({ userName: promoteTarget.name, isAdmin: !promoteTarget.isAdmin });
              setUsers(prev => prev.map(u => u.name === promoteTarget.name ? { ...u, isAdmin: !promoteTarget.isAdmin, isUnassigned: !promoteTarget.isAdmin ? false : u.isUnassigned } : u));
            }}
            onClose={() => setPromoteTarget(null)}
          />
        )}

        {deleteTarget && (
          <ConfirmDialog
            title={`Remove user — ${deleteTarget.displayName}`}
            body={`${deleteTarget.displayName} will be removed from the portal. This cannot be undone. They can re-register through the onboarding flow if needed.`}
            confirmLabel="Remove user"
            danger
            onConfirm={async () => {
              await api.deleteUser(deleteTarget.name);
              setUsers(prev => prev.filter(u => u.name !== deleteTarget.name));
            }}
            onClose={() => setDeleteTarget(null)}
          />
        )}
      </Content>
    </Page>
  );
};
