import React, { useState } from 'react';
import {
  Content,
  Header,
  Page,
  ContentHeader,
  SupportButton,
  InfoCard,
  Progress,
  ErrorBoundary,
} from '@backstage/core-components';
import { useApi, fetchApiRef, discoveryApiRef } from '@backstage/core-plugin-api';
import { UserPickerField, CatalogUser } from './UserPickerField';
import {
  Grid,
  Button,
  TextField,
  MenuItem,
  Paper,
  Typography,
  Step,
  Stepper,
  StepLabel,
  makeStyles,
} from '@material-ui/core';
import { Alert } from '@material-ui/lab';
import PersonAddIcon from '@material-ui/icons/PersonAdd';
import GroupAddIcon from '@material-ui/icons/GroupAdd';
import AssignmentIcon from '@material-ui/icons/Assignment';

const useStyles = makeStyles((theme) => ({
  root: {
    width: '100%',
  },
  button: {
    marginRight: theme.spacing(1),
  },
  stepper: {
    padding: theme.spacing(3, 0, 5),
  },
  formControl: {
    margin: theme.spacing(1),
    minWidth: 120,
  },
  buttonGroup: {
    marginTop: theme.spacing(3),
    display: 'flex',
    justifyContent: 'space-between',
  },
  memberCard: {
    padding: theme.spacing(2),
    marginBottom: theme.spacing(2),
  },
  addButton: {
    marginTop: theme.spacing(2),
  },
}));

export const ProjectRegistrationPage = () => {
  const classes = useStyles();
  const fetchApi = useApi(fetchApiRef);
  const discoveryApi = useApi(discoveryApiRef);
  const [activeStep, setActiveStep] = useState(0);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    client_name: '',
    start_date: '',
    end_date: '',
    pm_tool: 'none',
    jira_key: '',
    jira_template: 'scrum',
    team_name: '',
    team_members: [{ fullName: '', email: '', role: '', accessLevel: 'member' }],
  });

  const [submitStatus, setSubmitStatus] = useState({
    loading: false,
    error: null as string | null,
    success: false,
    projectId: null as string | null,
  });

  const handleNext = () => setActiveStep((prevStep) => prevStep + 1);
  const handleBack = () => setActiveStep((prevStep) => prevStep - 1);

  const handleChange = (field: string) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [field]: event.target.value });
  };

  const [selectedUsers, setSelectedUsers] = useState<(CatalogUser | null)[]>([null]);

  const handleTeamMemberChange = (index: number, field: string) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const newTeamMembers = [...formData.team_members];
    newTeamMembers[index] = { ...newTeamMembers[index], [field]: event.target.value };
    setFormData({ ...formData, team_members: newTeamMembers });
  };

  const handleUserSelect = (index: number, user: CatalogUser | null) => {
    const newSelected = [...selectedUsers];
    newSelected[index] = user;
    setSelectedUsers(newSelected);
    const newTeamMembers = [...formData.team_members];
    newTeamMembers[index] = {
      ...newTeamMembers[index],
      fullName: user?.displayName ?? '',
      email: user?.email ?? '',
    };
    setFormData({ ...formData, team_members: newTeamMembers });
  };

  const addTeamMember = () => {
    setFormData({
      ...formData,
      team_members: [...formData.team_members, { fullName: '', email: '', role: '', accessLevel: 'member' }],
    });
    setSelectedUsers([...selectedUsers, null]);
  };

  const removeTeamMember = (index: number) => {
    setFormData({ ...formData, team_members: formData.team_members.filter((_, i) => i !== index) });
    setSelectedUsers(selectedUsers.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    setSubmitStatus({ loading: true, error: null, success: false, projectId: null });

    try {
      const baseUrl = await discoveryApi.getBaseUrl('project-registration');
      const response = await fetchApi.fetch(`${baseUrl}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          description: formData.description || undefined,
          client_name: formData.client_name,
          start_date: formData.start_date || undefined,
          end_date: formData.end_date || undefined,
          pm_tool: formData.pm_tool !== 'none' ? formData.pm_tool : undefined,
          jira_key: formData.pm_tool === 'jira' ? formData.jira_key || undefined : undefined,
          jira_template: formData.pm_tool === 'jira' ? formData.jira_template || undefined : undefined,
          team_name: formData.team_name || undefined,
          team_members: formData.team_members.filter(m => m.fullName || m.email),
        }),
      });

      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error || `Request failed with status ${response.status}`);
      }

      const project = await response.json();
      setSubmitStatus({ loading: false, error: null, success: true, projectId: project.id });
    } catch (error: any) {
      setSubmitStatus({ loading: false, error: error.message || 'Failed to create project', success: false, projectId: null });
    }
  };

  const getStepContent = (step: number) => {
    switch (step) {
      case 0:
        return (
          <InfoCard title="Project Details">
            <Grid container spacing={3}>
              <Grid item xs={12}>
                <TextField
                  required
                  fullWidth
                  label="Project Name"
                  value={formData.name}
                  onChange={handleChange('name')}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  multiline
                  rows={4}
                  label="Project Description"
                  value={formData.description}
                  onChange={handleChange('description')}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  required
                  fullWidth
                  label="Client Name"
                  value={formData.client_name}
                  onChange={handleChange('client_name')}
                />
              </Grid>
              <Grid item xs={6}>
                <TextField
                  fullWidth
                  type="date"
                  label="Start Date"
                  InputLabelProps={{ shrink: true }}
                  value={formData.start_date}
                  onChange={handleChange('start_date')}
                />
              </Grid>
              <Grid item xs={6}>
                <TextField
                  fullWidth
                  type="date"
                  label="Expected End Date"
                  InputLabelProps={{ shrink: true }}
                  value={formData.end_date}
                  onChange={handleChange('end_date')}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  select
                  label="Project Management Tool"
                  value={formData.pm_tool}
                  onChange={handleChange('pm_tool')}
                  helperText="Optional — select your team's PM tool"
                >
                  <MenuItem value="none">None</MenuItem>
                  <MenuItem value="jira">Jira</MenuItem>
                  <MenuItem value="github">GitHub Projects</MenuItem>
                </TextField>
              </Grid>
              {formData.pm_tool === 'jira' && (
                <>
                  <Grid item xs={6}>
                    <TextField
                      fullWidth
                      label="Jira Project Key"
                      helperText="2-10 uppercase letters (e.g., PROJ)"
                      value={formData.jira_key}
                      onChange={handleChange('jira_key')}
                    />
                  </Grid>
                  <Grid item xs={6}>
                    <TextField
                      fullWidth
                      select
                      label="Jira Template"
                      value={formData.jira_template}
                      onChange={handleChange('jira_template')}
                    >
                      <MenuItem value="scrum">Scrum</MenuItem>
                      <MenuItem value="kanban">Kanban</MenuItem>
                      <MenuItem value="basic">Basic</MenuItem>
                    </TextField>
                  </Grid>
                </>
              )}
            </Grid>
          </InfoCard>
        );

      case 1:
        return (
          <InfoCard title="Team Setup">
            <Grid container spacing={3}>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Team Name"
                  value={formData.team_name}
                  onChange={handleChange('team_name')}
                  helperText="Optional — leave blank to assign a team later"
                />
              </Grid>
              <Grid item xs={12}>
                <Typography variant="subtitle2" style={{ marginBottom: 8 }}>Team Members</Typography>
              </Grid>
            </Grid>
          </>
        )}
      </Grid>
    </Box>
  );

  const PROJECT_TEAMS: Record<string, string> = {
    'web-team': 'Web',
    'mobile-team': 'Mobile',
    'data-team': 'Data',
    'cloud-team': 'Cloud',
    'ai-team': 'AI',
    'qa-team': 'QA',
    'sa-team': 'SolArch',
  };

  const renderTeamSetup = () => (
    <Box style={card}>
      <Typography style={sectionLabel}>Team Setup</Typography>
      <Grid container spacing={2}>
        <Grid item xs={12}>
          <TextField
            fullWidth select variant="outlined" size="small"
            label="Assigned Team"
            value={formData.team_name}
            onChange={handleChange('team_name')}
            helperText="Select the department team — or None for solo projects"
          >
            <MenuItem value="">None</MenuItem>
            {Object.entries(PROJECT_TEAMS).map(([value, label]) => (
              <MenuItem key={value} value={value}>{label}</MenuItem>
            ))}
          </TextField>
        </Grid>
      </Grid>

      <Typography style={{ ...sectionLabel, marginTop: 20 }}>Team Members</Typography>

      {formData.team_members.map((member, index) => (
        <Box
          key={index}
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
              Member {index + 1}
            </Typography>
            {index > 0 && (
              <button
                type="button"
                onClick={() => removeTeamMember(index)}
                aria-label={`Remove member ${index + 1}`}
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
                value={selectedUsers[index] ?? null}
                onChange={user => handleUserSelect(index, user)}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth select variant="outlined" size="small"
                label="Role"
                value={member.role}
                onChange={handleTeamMemberChange(index, 'role')}
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
                onChange={handleTeamMemberChange(index, 'accessLevel')}
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
        onClick={addTeamMember}
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
    </Box>
  );

  const renderReview = () => {
    const members = formData.team_members.filter(m => m.fullName || m.email);
    return (
      <Box style={card}>
        <Typography style={sectionLabel}>Review &amp; Create</Typography>
        <Typography style={{ fontSize: '0.8125rem', color: c.textSecondary, marginBottom: 16 }}>
          Review the information below. Use Back to make changes before creating.
        </Typography>

        {/* Project details */}
        <Typography style={{ ...sectionLabel, marginTop: 8, marginBottom: 8 }}>Project</Typography>
        <div style={reviewRow}>
          <span style={reviewLabel}>Name</span>
          <span style={reviewValue}>{formData.name}</span>
        </div>
        {formData.description && (
          <div style={reviewRow}>
            <span style={reviewLabel}>Description</span>
            <span style={{ ...reviewValue, maxWidth: 400 }}>{formData.description}</span>
          </div>
        )}
        <div style={reviewRow}>
          <span style={reviewLabel}>Client</span>
          <span style={reviewValue}>{formData.client_name}</span>
        </div>
        {formData.start_date && (
          <div style={reviewRow}>
            <span style={reviewLabel}>Start Date</span>
            <span style={reviewValue}>{formData.start_date}</span>
          </div>
        )}
        {formData.end_date && (
          <div style={reviewRow}>
            <span style={reviewLabel}>End Date</span>
            <span style={reviewValue}>{formData.end_date}</span>
          </div>
        )}
        {formData.pm_tool !== 'none' && (
          <div style={reviewRow}>
            <span style={reviewLabel}>PM Tool</span>
            <span style={reviewValue}>{PM_TOOL_LABELS[formData.pm_tool] ?? formData.pm_tool}</span>
          </div>
        )}
        {formData.pm_tool === 'jira' && formData.jira_key && (
          <div style={reviewRow}>
            <span style={reviewLabel}>Jira Key</span>
            <span style={reviewValue}>{formData.jira_key}</span>
          </div>
        )}
        {formData.pm_tool === 'jira' && (
          <div style={reviewRow}>
            <span style={reviewLabel}>Jira Template</span>
            <span style={reviewValue}>{formData.jira_template}</span>
          </div>
        )}

        {/* Team */}
        <Typography style={{ ...sectionLabel, marginTop: 20, marginBottom: 8 }}>Team</Typography>
        <div style={reviewRow}>
          <span style={reviewLabel}>Assigned Team</span>
          <span style={reviewValue}>{PROJECT_TEAMS[formData.team_name] || formData.team_name || '—'}</span>
        </div>
        {members.length > 0 ? (
          <div style={{ ...reviewRow, flexDirection: 'column', gap: 8, borderBottom: 'none' }}>
            <span style={reviewLabel}>Members ({members.length})</span>
            {members.map((m, i) => (
              <Box
                key={i}
                display="flex"
                justifyContent="space-between"
                alignItems="center"
                style={{
                  padding: '8px 12px',
                  background: c.surfaceSubtle,
                  border: `1px solid ${c.border}`,
                  borderRadius: 6,
                }}
              >
                <Box>
                  <Typography style={{ fontSize: '0.875rem', color: c.text, fontWeight: 500 }}>
                    {m.fullName}
                  </Typography>
                  <Typography style={{ fontSize: '0.75rem', color: c.textMuted }}>
                    {m.email}
                  </Typography>
                </Box>
                <Box style={{ textAlign: 'right' }}>
                  <Typography style={{ fontSize: '0.8125rem', color: c.textSecondary }}>
                    {ROLE_LABELS[m.role] ?? (m.role || '—')}
                  </Typography>
                  <Typography style={{ fontSize: '0.75rem', color: c.textMuted }}>
                    {ACCESS_LABELS[m.accessLevel] ?? m.accessLevel}
                  </Typography>
                </Box>
              </Box>
            ))}
            <Button
              type="button"
              variant="outlined"
              color="primary"
              fullWidth
              onClick={addTeamMember}
              className={classes.addButton}
              startIcon={<PersonAddIcon />}
            >
              Add Team Member
            </Button>
          </InfoCard>
        );

      default:
        return null;
    }
  };

  const steps = [
    { label: 'Project Details', icon: <AssignmentIcon /> },
    { label: 'Team Setup', icon: <GroupAddIcon /> },
  ];

  return (
    <ErrorBoundary>
      <Page themeId="tool">
        <Header title="Project Registration" subtitle="Register a new project and team" />
        <Content>
          <ContentHeader title="">
            <SupportButton>
              Register a new project with optional Jira or GitHub Projects integration
            </SupportButton>
          </ContentHeader>

          <Grid container spacing={3}>
            <Grid item xs={12}>
              <Stepper activeStep={activeStep} className={classes.stepper}>
                {steps.map(({ label, icon }) => (
                  <Step key={label}>
                    <StepLabel StepIconComponent={() => icon}>{label}</StepLabel>
                  </Step>
                ))}
              </Stepper>

              {submitStatus.success ? (
                <Alert severity="success">
                  Project created successfully! ID: {submitStatus.projectId}
                </Alert>
              ) : (
                <div>
                  {getStepContent(activeStep)}

                  {submitStatus.error && (
                    <Alert severity="error" style={{ marginTop: 16 }}>
                      {submitStatus.error}
                    </Alert>
                  )}

                  <div className={classes.buttonGroup}>
                    <Button
                      disabled={activeStep === 0}
                      onClick={handleBack}
                      className={classes.button}
                    >
                      Back
                    </Button>
                    <div>
                      {activeStep === steps.length - 1 ? (
                        <Button
                          variant="contained"
                          color="primary"
                          onClick={handleSubmit}
                          disabled={submitStatus.loading || !formData.name || !formData.client_name}
                        >
                          {submitStatus.loading ? <Progress /> : 'Create Project'}
                        </Button>
                      ) : (
                        <Button
                          variant="contained"
                          color="primary"
                          onClick={handleNext}
                          disabled={activeStep === 0 && (!formData.name || !formData.client_name)}
                        >
                          Next
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </Grid>
          </Grid>
        </Content>
      </Page>
    </ErrorBoundary>
  );
};

export default ProjectRegistrationPage;
