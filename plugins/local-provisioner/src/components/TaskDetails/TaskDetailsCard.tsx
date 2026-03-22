import React from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  Typography,
  Chip,
  Box,
  makeStyles,
  Divider,
} from '@material-ui/core';
import { ProvisioningTask, TaskStatus } from '../../api/types';

const useStyles = makeStyles(theme => ({
  card: {
    marginBottom: theme.spacing(2),
  },
  statusChip: {
    fontWeight: 600,
  },
  section: {
    marginBottom: theme.spacing(2),
  },
  sectionTitle: {
    fontWeight: 600,
    marginBottom: theme.spacing(1),
    color: theme.palette.text.secondary,
  },
  configBox: {
    backgroundColor: theme.palette.type === 'dark' ? '#1e1e1e' : '#f5f5f5',
    padding: theme.spacing(2),
    borderRadius: theme.shape.borderRadius,
    fontFamily: 'monospace',
    fontSize: '0.875rem',
    overflow: 'auto',
  },
  logsBox: {
    backgroundColor: theme.palette.type === 'dark' ? '#1e1e1e' : '#f5f5f5',
    padding: theme.spacing(2),
    borderRadius: theme.shape.borderRadius,
    fontFamily: 'monospace',
    fontSize: '0.875rem',
    overflow: 'auto',
    maxHeight: 300,
  },
}));

interface TaskDetailsCardProps {
  task: ProvisioningTask;
}

export const TaskDetailsCard = ({ task }: TaskDetailsCardProps) => {
  const classes = useStyles();

  const getStatusColor = (
    status: TaskStatus,
  ): 'default' | 'primary' | 'secondary' => {
    switch (status) {
      case 'completed':
        return 'primary';
      case 'in-progress':
        return 'secondary';
      case 'failed':
      case 'pending':
      default:
        return 'default';
    }
  };

  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  return (
    <Card className={classes.card}>
      <CardHeader
        title={task.resourceName}
        subheader={`Task ID: ${task.id}`}
        action={
          <Chip
            className={classes.statusChip}
            label={task.status}
            color={getStatusColor(task.status)}
            size="small"
          />
        }
      />
      <CardContent>
        <Box className={classes.section}>
          <Typography variant="body2" className={classes.sectionTitle}>
            Task Information
          </Typography>
          <Typography variant="body2">
            <strong>Type:</strong> {task.taskType}
          </Typography>
          <Typography variant="body2">
            <strong>Agent ID:</strong> {task.agentId}
          </Typography>
        </Box>

        <Divider />

        <Box className={classes.section} mt={2}>
          <Typography variant="body2" className={classes.sectionTitle}>
            Timestamps
          </Typography>
          <Typography variant="body2">
            <strong>Created:</strong> {formatDate(task.createdAt)}
          </Typography>
          <Typography variant="body2">
            <strong>Updated:</strong> {formatDate(task.updatedAt)}
          </Typography>
          {task.startedAt && (
            <Typography variant="body2">
              <strong>Started:</strong> {formatDate(task.startedAt)}
            </Typography>
          )}
          {task.completedAt && (
            <Typography variant="body2">
              <strong>Completed:</strong> {formatDate(task.completedAt)}
            </Typography>
          )}
        </Box>

        {task.errorMessage && (
          <>
            <Divider />
            <Box className={classes.section} mt={2}>
              <Typography variant="body2" className={classes.sectionTitle}>
                Error Message
              </Typography>
              <Typography variant="body2" color="error">
                {task.errorMessage}
              </Typography>
            </Box>
          </>
        )}

        <Divider />

        <Box className={classes.section} mt={2}>
          <Typography variant="body2" className={classes.sectionTitle}>
            Configuration
          </Typography>
          <Box className={classes.configBox}>
            <pre>{JSON.stringify(task.config, null, 2)}</pre>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
};
