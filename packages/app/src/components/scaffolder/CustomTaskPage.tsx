/**
 * Custom Scaffolder Task Page — Geist design.
 * Replaces OngoingTask with our styled layout while reusing
 * TaskSteps, TaskLogStream, and DefaultTemplateOutputs from scaffolder-react.
 */
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Page, Header, Content, ErrorPanel } from '@backstage/core-components';
import { Box, Button, Typography } from '@material-ui/core';
import { useTaskEventStream, scaffolderApiRef } from '@backstage/plugin-scaffolder-react';
import { TaskLogStream } from '@backstage/plugin-scaffolder-react/alpha';
import { useApi, useAnalytics } from '@backstage/core-plugin-api';
import { parseEntityRef } from '@backstage/catalog-model';
import { usePermission } from '@backstage/plugin-permission-react';
import { taskCancelPermission, taskReadPermission } from '@backstage/plugin-scaffolder-common/alpha';
import { useColors, semantic } from '@stratpoint/theme-utils';
import { X as XIcon, FileText, Play, CheckCircle, Circle, Loader, AlertCircle, ExternalLink, LayoutGrid } from 'lucide-react';

export const CustomTaskPage = () => {
  const c = useColors();
  const { taskId } = useParams();
  const taskStream = useTaskEventStream(taskId!);
  const navigate = useNavigate();
  const analytics = useAnalytics();
  const scaffolderApi = useApi(scaffolderApiRef);

  const [logsVisible, setLogsVisible] = useState(false);

  const { allowed: canCancelTask } = usePermission({ permission: taskCancelPermission, resourceRef: taskId });
  const { allowed: canReadTask } = usePermission({ permission: taskReadPermission, resourceRef: taskId });

  const cancelEnabled = !(taskStream.cancelled || taskStream.completed);

  const steps = useMemo(
    () => (taskStream.task?.spec.steps ?? [])
      .filter(step => !step.id.startsWith('resolve-') && !step.id.startsWith('fetch-'))
      .map(step => ({
        ...step,
        ...taskStream?.steps?.[step.id],
      })),
    [taskStream],
  );

  const activeStep = useMemo(() => {
    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i].status !== 'open') return i;
    }
    return 0;
  }, [steps]);

  // Show logs on error or completion
  useEffect(() => {
    if (taskStream.error) setLogsVisible(true);
    if (taskStream.completed && !taskStream.error) setLogsVisible(true);
  }, [taskStream.error, taskStream.completed]);

  const handleCancel = useCallback(async () => {
    if (taskId) {
      analytics.captureEvent('cancelled', 'Template has been cancelled');
      await scaffolderApi.cancelTask(taskId);
    }
  }, [taskId, analytics, scaffolderApi]);

  const handleStartOver = useCallback(() => {
    navigate('/create');
  }, [navigate]);

  const templateName = taskStream.task?.spec.templateInfo?.entity?.metadata?.name ?? 'template';

  const card = {
    background: c.surface,
    border: `1px solid ${c.border}`,
    borderRadius: 8,
    padding: '20px 24px',
    marginBottom: 16,
  } as const;

  const sectionLabel: React.CSSProperties = {
    fontSize: '0.6875rem',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: c.textMuted,
    marginBottom: 12,
  };

  return (
    <Page themeId="tool">
      <Header
        title={`Creating ${templateName}`}
        subtitle={`Task ${taskId}`}
      />
      <Content>
        <Box style={{ maxWidth: 960, width: '100%', margin: '0 auto' }}>

          {/* Error */}
          {taskStream.error && (
            <Box style={{ marginBottom: 16 }}>
              <ErrorPanel error={taskStream.error} titleFormat="markdown" title={taskStream.error.message} />
            </Box>
          )}

          {/* Steps — horizontal, same as wizard */}
          <Box style={card}>
            <Typography style={sectionLabel}>Steps</Typography>
            <Box display="flex" alignItems="flex-start" style={{ marginTop: 8 }}>
              {steps.map((step: any, idx: number) => {
                const isDone = step.status === 'completed';
                const isFailed = step.status === 'failed';
                const isRunning = step.status === 'processing';
                const isActive = idx === activeStep;
                const isLast = idx === steps.length - 1;

                let stepBg = 'transparent';
                if (isDone) stepBg = semantic.successBg;
                else if (isFailed) stepBg = semantic.errorBg;
                else if (isRunning) stepBg = c.surface;

                let stepBorder = c.border;
                if (isDone) stepBorder = semantic.success;
                else if (isFailed) stepBorder = semantic.error;
                else if (isRunning) stepBorder = c.blue;

                let stepColor = c.textMuted;
                if (isDone) stepColor = c.textSecondary;
                else if (isFailed) stepColor = semantic.error;
                else if (isRunning) stepColor = c.text;

                return (
                  <React.Fragment key={step.id}>
                    <Box display="flex" flexDirection="column" alignItems="center" style={{ flex: 0, minWidth: 60 }}>
                      <Box
                        display="flex" alignItems="center" justifyContent="center"
                        style={{
                          width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                          background: stepBg,
                          border: `2px solid ${stepBorder}`,
                        }}
                      >
                        {isDone && <CheckCircle size={16} color={semantic.success} strokeWidth={2} />}
                        {isFailed && <AlertCircle size={16} color={semantic.error} strokeWidth={2} />}
                        {isRunning && <Loader size={14} color={c.blue} strokeWidth={2} style={{ animation: 'spin 1s linear infinite' }} />}
                        {!isDone && !isFailed && !isRunning && <Circle size={14} color={c.textMuted} strokeWidth={2} />}
                      </Box>
                      <Typography style={{
                        fontSize: '0.75rem',
                        fontWeight: isActive || isRunning ? 600 : 500,
                        color: stepColor,
                        marginTop: 6, textAlign: 'center', lineHeight: 1.3, maxWidth: 100,
                      }}>
                        {step.name}
                      </Typography>
                    </Box>
                    {!isLast && (
                      <Box style={{
                        flex: 1, height: 2, minWidth: 16, marginTop: 15,
                        background: isDone ? `${semantic.success}33` : c.border,
                        borderRadius: 1,
                      }} />
                    )}
                  </React.Fragment>
                );
              })}
            </Box>
          </Box>

          {/* Output links — custom Geist rendering */}
          {taskStream.completed && !taskStream.error && taskStream.output?.links && (
            <Box style={card}>
              <Typography style={sectionLabel}>Output</Typography>
              <Box display="flex" style={{ gap: 8, flexWrap: 'wrap' }}>
                {(taskStream.output.links as Array<{ title?: string; url?: string; entityRef?: string; icon?: string }>).map((link, i) => {
                  const isExternal = !!link.url;
                  const entityHref = link.entityRef ? (() => {
                    try {
                      const { kind, namespace, name } = parseEntityRef(link.entityRef);
                      return `/catalog/${namespace ?? 'default'}/${kind.toLowerCase()}/${name}`;
                    } catch {
                      return '#';
                    }
                  })() : '#';
                  const href = link.url ?? entityHref;
                  const Icon = link.icon === 'catalog' ? LayoutGrid : ExternalLink;
                  return (
                    <a
                      key={i}
                      href={href}
                      target={isExternal ? '_blank' : undefined}
                      rel={isExternal ? 'noopener noreferrer' : undefined}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '8px 16px', borderRadius: 6,
                        background: 'transparent', border: `1px solid ${c.border}`,
                        color: c.text, fontSize: '0.8125rem', fontWeight: 500,
                        textDecoration: 'none',
                      }}
                    >
                      <Icon size={14} strokeWidth={1.5} aria-hidden="true" />
                      {link.title ?? 'Link'}
                    </a>
                  );
                })}
              </Box>
            </Box>
          )}

          {/* Action buttons */}
          <Box display="flex" justifyContent="space-between" style={{ marginBottom: 16 }}>
            <Box display="flex" style={{ gap: 8 }}>
              <Button
                variant="outlined" size="small"
                disabled={!cancelEnabled || !canCancelTask}
                onClick={handleCancel}
                startIcon={<XIcon size={14} strokeWidth={1.5} />}
              >
                Cancel
              </Button>
              <Button
                variant="outlined" size="small"
                onClick={() => setLogsVisible(v => !v)}
                startIcon={<FileText size={14} strokeWidth={1.5} />}
              >
                {logsVisible ? 'Hide Logs' : 'Show Logs'}
              </Button>
            </Box>
            <Button
              variant="contained" color="primary" size="small"
              disabled={cancelEnabled || !canReadTask}
              onClick={handleStartOver}
              startIcon={<Play size={14} strokeWidth={1.5} />}
            >
              Start Over
            </Button>
          </Box>

          {/* Logs */}
          {logsVisible && (
            <Box style={{
              ...card,
              padding: 0,
              overflow: 'hidden',
              height: 400,
            }}>
              <Box style={{
                height: '100%',
                overflow: 'auto',
                padding: 16,
                background: c.surfaceSubtle,
              }}>
                <div className="geist-log-stream">
                  <TaskLogStream logs={taskStream.stepLogs} />
                </div>
              </Box>
            </Box>
          )}
        </Box>
      </Content>
    </Page>
  );
};
