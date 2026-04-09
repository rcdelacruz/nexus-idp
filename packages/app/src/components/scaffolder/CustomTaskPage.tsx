/**
 * Custom Scaffolder Task Page — Geist design.
 * Replaces OngoingTask with our styled layout while reusing
 * TaskSteps, TaskLogStream, and DefaultTemplateOutputs from scaffolder-react.
 *
 * Layout: two-column — vertical step sidebar on the left, main content on the right.
 */
import React, { useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Page, Header, Content, ErrorPanel } from '@backstage/core-components';
import { Box, Button, Typography } from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';
import { useTaskEventStream, scaffolderApiRef } from '@backstage/plugin-scaffolder-react';
import { TaskLogStream } from '@backstage/plugin-scaffolder-react/alpha';
import { useApi, useAnalytics } from '@backstage/core-plugin-api';
import { parseEntityRef } from '@backstage/catalog-model';
import { usePermission } from '@backstage/plugin-permission-react';
import { taskCancelPermission, taskReadPermission } from '@backstage/plugin-scaffolder-common/alpha';
import { useColors, semantic } from '@stratpoint/theme-utils';
import { X as XIcon, FileText, Play, CheckCircle, Circle, Loader, AlertCircle, ExternalLink, LayoutGrid } from 'lucide-react';

const useLogStyles = makeStyles(() => ({
  monoWrapper: {
    // Directly target every descendant — inheritance alone is unreliable when
    // global body/component styles interfere.
    '& *': {
      fontFamily: '"Geist Mono", "Fira Code", "Courier New", monospace !important',
    },
  },
}));

export const CustomTaskPage = () => {
  const c = useColors();
  const logStyles = useLogStyles();
  const { taskId } = useParams();
  const taskStream = useTaskEventStream(taskId!);
  const navigate = useNavigate();
  const analytics = useAnalytics();
  const scaffolderApi = useApi(scaffolderApiRef);

  const [logsVisible, setLogsVisible] = useState(true);

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

  // ── Vertical step sidebar ───────────────────────────────────────────────────
  const renderSidebar = () => (
    <Box style={{ width: 200, flexShrink: 0 }}>
      <Typography style={{ ...sectionLabel, marginBottom: 16 }}>Steps</Typography>
      {steps.map((step: any, idx) => {
        const isDone = step.status === 'completed';
        const isFailed = step.status === 'failed';
        const isRunning = step.status === 'processing';
        const isActive = idx === activeStep;
        const isLast = idx === steps.length - 1;

        let stepBg = 'transparent';
        if (isDone) stepBg = semantic.successBg;
        else if (isFailed) stepBg = semantic.errorBg;
        else if (isRunning || isActive) stepBg = c.surface;

        let stepBorder = c.border;
        if (isDone) stepBorder = semantic.success;
        else if (isFailed) stepBorder = semantic.error;
        else if (isRunning || isActive) stepBorder = c.blue;

        let labelColor = c.textMuted;
        if (isDone) labelColor = c.textSecondary;
        else if (isFailed) labelColor = semantic.error;
        else if (isRunning || isActive) labelColor = c.text;

        return (
          <Box key={step.id} display="flex" alignItems="flex-start" style={{ gap: 10 }}>
            {/* Left column: circle + connector — anchored regardless of label height */}
            <Box display="flex" flexDirection="column" alignItems="center" style={{ flexShrink: 0 }}>
              <Box
                display="flex" alignItems="center" justifyContent="center"
                style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: stepBg,
                  border: `2px solid ${stepBorder}`,
                }}
              >
                {isDone && <CheckCircle size={14} color={semantic.success} strokeWidth={2} />}
                {isFailed && <AlertCircle size={14} color={semantic.error} strokeWidth={2} />}
                {isRunning && (
                  <Loader
                    size={13} color={c.blue} strokeWidth={2}
                    style={{ animation: 'spin 1s linear infinite' }}
                  />
                )}
                {!isDone && !isFailed && !isRunning && (
                  <Circle size={13} color={c.textMuted} strokeWidth={2} />
                )}
              </Box>
              {!isLast && (
                <Box style={{
                  width: 2, flexGrow: 1, minHeight: 16,
                  background: isDone ? `${semantic.success}44` : c.border,
                  marginTop: 4, marginBottom: 4,
                }} />
              )}
            </Box>

            {/* Right: label — wraps naturally, no overflow */}
            <Typography style={{
              fontSize: '0.8125rem',
              fontWeight: isRunning || isActive ? 600 : 400,
              color: labelColor,
              lineHeight: 1.4,
              wordBreak: 'break-word',
              paddingTop: 4,
              paddingBottom: !isLast ? 16 : 0,
            }}>
              {step.name}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );

  return (
    <Page themeId="tool">
      <Header
        title={`Creating ${templateName}`}
        subtitle={`Task ${taskId}`}
      />
      <Content>
        <Box style={{ maxWidth: '100%', width: '100%' }}>

          {/* Error */}
          {taskStream.error && (
            <Box style={{ marginBottom: 16 }}>
              <ErrorPanel error={taskStream.error} titleFormat="markdown" title={taskStream.error.message} />
            </Box>
          )}

          {/* Two-column layout */}
          <Box display="flex" style={{ gap: 32, alignItems: 'flex-start' }}>

            {/* Left: vertical step sidebar */}
            <Box style={{
              position: 'sticky',
              top: 16,
              flexShrink: 0,
              maxHeight: 'calc(100vh - 100px)',
              overflowY: 'auto',
            }}>
              {renderSidebar()}
            </Box>

            {/* Right: main content */}
            <Box style={{ flex: 1, minWidth: 0 }}>

              {/* Output links */}
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

              {/* Logs — TaskLogStream uses AutoSizer so height is driven by parent */}
              {logsVisible && (
                <Box className={logStyles.monoWrapper} style={{
                  ...card,
                  padding: 0,
                  overflow: 'hidden',
                  height: 'calc(100vh - 280px)',
                  minHeight: 300,
                }}>
                  <TaskLogStream logs={taskStream.stepLogs} />
                </Box>
              )}
            </Box>
          </Box>
        </Box>
      </Content>
    </Page>
  );
};
