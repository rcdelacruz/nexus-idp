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
import {
  Grid,
  Button,
  TextField,
  MenuItem,
  Paper,
  Typography,
  Radio,
  RadioGroup,
  FormControlLabel,
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
  const [activeStep, setActiveStep] = useState(0);
  const [formData, setFormData] = useState({
    projectName: '',
    projectDescription: '',
    clientName: '',
    startDate: '',
    expectedEndDate: '',
    jiraProjectKey: '',
    jiraProjectTemplate: 'scrum',
    teamName: '',
    isNewTeam: true,
    existingTeamId: '',
    teamMembers: [{
      fullName: '',
      email: '',
      role: '',
      accessLevel: 'member'
    }]
  });

  const [submitStatus, setSubmitStatus] = useState({
    loading: false,
    error: null as string | null,
    success: false,
  });

  const handleNext = () => {
    setActiveStep((prevStep) => prevStep + 1);
  };

  const handleBack = () => {
    setActiveStep((prevStep) => prevStep - 1);
  };

  const handleChange = (field: string) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [field]: event.target.value });
  };

  const handleTeamMemberChange = (index: number, field: string) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const newTeamMembers = [...formData.teamMembers];
    newTeamMembers[index] = {
      ...newTeamMembers[index],
      [field]: event.target.value,
    };
    setFormData({ ...formData, teamMembers: newTeamMembers });
  };

  const addTeamMember = () => {
    setFormData({
      ...formData,
      teamMembers: [
        ...formData.teamMembers,
        { fullName: '', email: '', role: '', accessLevel: 'member' },
      ],
    });
  };

  const removeTeamMember = (index: number) => {
    setFormData({
      ...formData,
      teamMembers: formData.teamMembers.filter((_, i) => i !== index),
    });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitStatus({ loading: true, error: null, success: false });

    try {
      // Here you would implement the API calls to Jira
      await new Promise(resolve => setTimeout(resolve, 1000)); // Simulated API call
      setSubmitStatus({ loading: false, error: null, success: true });
    } catch (error) {
      setSubmitStatus({ loading: false, error: 'Failed to create project', success: false });
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
                  value={formData.projectName}
                  onChange={handleChange('projectName')}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  required
                  fullWidth
                  multiline
                  rows={4}
                  label="Project Description"
                  value={formData.projectDescription}
                  onChange={handleChange('projectDescription')}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  required
                  fullWidth
                  label="Client Name"
                  value={formData.clientName}
                  onChange={handleChange('clientName')}
                />
              </Grid>
              <Grid item xs={6}>
                <TextField
                  required
                  fullWidth
                  type="date"
                  label="Start Date"
                  InputLabelProps={{ shrink: true }}
                  value={formData.startDate}
                  onChange={handleChange('startDate')}
                />
              </Grid>
              <Grid item xs={6}>
                <TextField
                  required
                  fullWidth
                  type="date"
                  label="Expected End Date"
                  InputLabelProps={{ shrink: true }}
                  value={formData.expectedEndDate}
                  onChange={handleChange('expectedEndDate')}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  required
                  fullWidth
                  label="Jira Project Key"
                  helperText="2-10 uppercase letters (e.g., PROJ)"
                  value={formData.jiraProjectKey}
                  onChange={handleChange('jiraProjectKey')}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  required
                  fullWidth
                  select
                  label="Project Template"
                  value={formData.jiraProjectTemplate}
                  onChange={handleChange('jiraProjectTemplate')}
                >
                  <MenuItem value="scrum">Scrum</MenuItem>
                  <MenuItem value="kanban">Kanban</MenuItem>
                  <MenuItem value="basic">Basic</MenuItem>
                </TextField>
              </Grid>
            </Grid>
          </InfoCard>
        );

      case 1:
        return (
          <InfoCard title="Team Setup">
            <Grid container spacing={3}>
              <Grid item xs={12}>
                <RadioGroup
                  value={formData.isNewTeam}
                  onChange={(e) => setFormData({ ...formData, isNewTeam: e.target.value === 'true' })}
                >
                  <FormControlLabel value="true" control={<Radio />} label="Create New Team" />
                  <FormControlLabel value="false" control={<Radio />} label="Use Existing Team" />
                </RadioGroup>
              </Grid>
              {formData.isNewTeam ? (
                <Grid item xs={12}>
                  <TextField
                    required
                    fullWidth
                    label="Team Name"
                    value={formData.teamName}
                    onChange={handleChange('teamName')}
                  />
                </Grid>
              ) : (
                <Grid item xs={12}>
                  <TextField
                    required
                    fullWidth
                    select
                    label="Select Existing Team"
                    value={formData.existingTeamId}
                    onChange={handleChange('existingTeamId')}
                  >
                    <MenuItem value="team1">Frontend Team</MenuItem>
                    <MenuItem value="team2">Backend Team</MenuItem>
                  </TextField>
                </Grid>
              )}
            </Grid>
          </InfoCard>
        );

      case 2:
        return (
          <InfoCard title="Team Members">
            {formData.teamMembers.map((member, index) => (
              <Paper key={index} className={classes.memberCard}>
                <Grid container spacing={3}>
                  <Grid item xs={12}>
                    <Typography variant="h6">
                      Team Member {index + 1}
                      {index > 0 && (
                        <Button
                          color="secondary"
                          onClick={() => removeTeamMember(index)}
                          style={{ float: 'right' }}
                        >
                          Remove
                        </Button>
                      )}
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <TextField
                      required
                      fullWidth
                      label="Full Name"
                      value={member.fullName}
                      onChange={handleTeamMemberChange(index, 'fullName')}
                    />
                  </Grid>
                  <Grid item xs={6}>
                    <TextField
                      required
                      fullWidth
                      label="Email"
                      type="email"
                      value={member.email}
                      onChange={handleTeamMemberChange(index, 'email')}
                    />
                  </Grid>
                  <Grid item xs={6}>
                    <TextField
                      required
                      fullWidth
                      select
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
                      required
                      fullWidth
                      select
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
              </Paper>
            ))}
            <Button
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
    { label: 'Team Members', icon: <PersonAddIcon /> },
  ];

  return (
    <ErrorBoundary>
      <Page themeId="tool">
        <Header title="Project Registration" subtitle="Register a new project and team" />
        <Content>
          <ContentHeader title="">
            <SupportButton>
              Register a new project and team with automatic Jira integration
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
                  Project and team successfully created!
                </Alert>
              ) : (
                <form onSubmit={handleSubmit}>
                  {getStepContent(activeStep)}

                  {submitStatus.error && (
                    <Alert severity="error">
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
                          type="submit"
                          disabled={submitStatus.loading}
                        >
                          {submitStatus.loading ? <Progress /> : 'Create Project'}
                        </Button>
                      ) : (
                        <Button
                          variant="contained"
                          color="primary"
                          onClick={handleNext}
                        >
                          Next
                        </Button>
                      )}
                    </div>
                  </div>
                </form>
              )}
            </Grid>
          </Grid>
        </Content>
      </Page>
    </ErrorBoundary>
  );
};

export default ProjectRegistrationPage;
