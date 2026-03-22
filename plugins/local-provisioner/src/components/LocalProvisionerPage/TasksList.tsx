import React from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Typography,
  Box,
  CircularProgress,
  makeStyles,
} from '@material-ui/core';
import { Alert } from '@material-ui/lab';
import { ProvisioningTask, TaskStatus } from '../../api/types';

const useStyles = makeStyles(theme => ({
  statusChip: {
    fontWeight: 600,
  },
  emptyState: {
    textAlign: 'center',
    padding: theme.spacing(4),
    color: theme.palette.text.secondary,
  },
  loadingBox: {
    display: 'flex',
    justifyContent: 'center',
    padding: theme.spacing(4),
  },
}));

interface TasksListProps {
  tasks: ProvisioningTask[];
  loading: boolean;
  error: Error | null;
}

export const TasksList = ({ tasks, loading, error }: TasksListProps) => {
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

  if (loading) {
    return (
      <Box className={classes.loadingBox}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error">
        Failed to load tasks: {error.message}
      </Alert>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className={classes.emptyState}>
        <Typography variant="h6" gutterBottom>
          No Tasks Yet
        </Typography>
        <Typography variant="body2">
          Use training templates to provision local resources and see tasks here.
        </Typography>
      </div>
    );
  }

  return (
    <TableContainer>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>Resource Name</TableCell>
            <TableCell>Type</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Created</TableCell>
            <TableCell>Updated</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {tasks.map(task => (
            <TableRow key={task.id} hover>
              <TableCell>{task.resourceName}</TableCell>
              <TableCell>{task.taskType}</TableCell>
              <TableCell>
                <Chip
                  className={classes.statusChip}
                  label={task.status}
                  color={getStatusColor(task.status)}
                  size="small"
                />
              </TableCell>
              <TableCell>{formatDate(task.createdAt)}</TableCell>
              <TableCell>{formatDate(task.updatedAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
};
