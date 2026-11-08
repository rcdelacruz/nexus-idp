import React from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, makeStyles, Typography } from '@material-ui/core';
import { alertApiRef, useApi } from '@backstage/core-plugin-api';
import { Copy, Download } from 'lucide-react';
import { checkSummary } from '../../api/checkSummary';
import { downloadFile } from '../../api/download';
import { parseGrade } from '../../api/labReport';
import { TraineeCheck } from '../../api/types';

const useStyles = makeStyles(theme => ({
  label: { fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: theme.palette.text.secondary, margin: theme.spacing(2, 0, 0.5) },
  facts: { borderCollapse: 'collapse', '& td': { padding: '2px 16px 2px 0', verticalAlign: 'top' }, '& td:first-child': { color: theme.palette.text.secondary, whiteSpace: 'nowrap' } },
  pre: {
    margin: 0,
    padding: theme.spacing(1.5),
    maxHeight: 360,
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontSize: '0.75rem',
    lineHeight: 1.5,
    border: '1px solid var(--border)',
    borderRadius: 6,
    background: 'var(--ds-background-200)',
    color: 'var(--fg-primary)',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  },
  table: { width: '100%', borderCollapse: 'collapse', '& th, & td': { textAlign: 'left', padding: '4px 10px 4px 0', borderBottom: '1px solid var(--border)', verticalAlign: 'top' }, '& th': { fontWeight: 600 } },
  num: { textAlign: 'right !important' as any, whiteSpace: 'nowrap' },
  bad: { color: '#e5484d' },
  muted: { color: theme.palette.text.secondary },
}));

const fileSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'check';

/**
 * Everything the portal knows about one result of an instructor check: for a grade, which items lost points and why; for a check that
 * failed, the agent's reason and the end of the job's log (the lines that say where it stopped), which can be copied or saved.
 */
export function CheckDetailsDialog({ check, title, traineeEmail, onClose }: { check: TraineeCheck | null; title: string; traineeEmail: string; onClose: () => void }) {
  const classes = useStyles();
  const alertApi = useApi(alertApiRef);
  const grade = check ? parseGrade(check.output) : undefined;
  const failed = check?.status === 'failed';
  const logs = check?.logs?.trim() ? check.logs : undefined;
  // A finished check that is not a grade (the seeded-resources check) shows what it printed.
  const printed = check && !grade && !failed && check.output?.trim() ? check.output : undefined;
  const when = check ? new Date(check.at).toLocaleString() : '';
  const lost = (grade?.items ?? []).filter(i => i.got < i.points);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(logs ?? '');
      alertApi.post({ message: 'Log copied', severity: 'success', display: 'transient' });
    } catch {
      alertApi.post({ message: 'Could not copy: select the text and copy it by hand', severity: 'error' });
    }
  };
  const save = () => {
    if (check && logs) downloadFile(`check-log-${fileSlug(check.name ?? title)}-${new Date(check.at).toISOString().slice(0, 10)}.txt`, 'text/plain', logs);
  };

  return (
    <Dialog open={!!check} onClose={onClose} fullWidth maxWidth="md" scroll="paper" aria-label={`${title} details`}>
      {check && (
        <>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent dividers>
            <table className={classes.facts}>
              <tbody>
                <tr>
                  <td>Trainee</td>
                  <td>{traineeEmail}</td>
                </tr>
                <tr>
                  <td>Result</td>
                  <td className={failed ? classes.bad : undefined}>{checkSummary(check)}</td>
                </tr>
                <tr>
                  <td>Finished</td>
                  <td>{when}</td>
                </tr>
                {check.exitCode !== undefined && check.exitCode !== null && (
                  <tr>
                    <td>Exit code</td>
                    <td>{check.exitCode}</td>
                  </tr>
                )}
              </tbody>
            </table>

            {grade && (
              <>
                <div className={classes.label}>
                  Score: {grade.autoTotal} of {grade.maxPoints} automated points{grade.phase ? ` (${grade.phase})` : ''}
                </div>
                {grade.hardFails.length > 0 && (
                  <>
                    <div className={`${classes.label} ${classes.bad}`}>Hard fails</div>
                    <ul>
                      {grade.hardFails.map((h, i) => (
                        <li key={i} className={classes.bad}>
                          {h}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <div className={classes.label}>Items that lost points</div>
                {lost.length === 0 ? (
                  <Typography variant="body2" className={classes.muted}>
                    Every automated item scored full points.
                  </Typography>
                ) : (
                  <table className={classes.table}>
                    <thead>
                      <tr>
                        <th>Area</th>
                        <th>Item</th>
                        <th className={classes.num}>Got</th>
                        <th>Why</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lost.map(i => (
                        <tr key={i.id}>
                          <td>{i.area ?? ''}</td>
                          <td>{i.title}</td>
                          <td className={classes.num}>
                            {i.got} / {i.points}
                          </td>
                          <td className={classes.muted}>{i.detail ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {grade.manual.length > 0 && (
                  <>
                    <div className={classes.label}>Left to grade by hand</div>
                    <ul>
                      {grade.manual.map((m, i) => (
                        <li key={i}>{m}</li>
                      ))}
                    </ul>
                  </>
                )}
                {grade.notes.length > 0 && (
                  <>
                    <div className={classes.label}>Notes from the grader</div>
                    <ul>
                      {grade.notes.map((n, i) => (
                        <li key={i}>{n}</li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}

            {failed && (
              <>
                <div className={classes.label}>What the agent reported</div>
                <Typography variant="body2">{check.error?.trim() || check.output?.trim() || 'No reason was reported.'}</Typography>
                <div className={classes.label}>Job output (the end of the log)</div>
                {logs ? (
                  <pre className={classes.pre} data-testid="check-log">
                    {logs}
                  </pre>
                ) : (
                  <Typography variant="body2" className={classes.muted}>
                    The agent sent no log for this result, only the reason above. Only the newest result of each check keeps its log.
                  </Typography>
                )}
              </>
            )}

            {printed && (
              <>
                <div className={classes.label}>Output</div>
                <pre className={classes.pre} data-testid="check-output">
                  {printed}
                </pre>
              </>
            )}
          </DialogContent>
          <DialogActions>
            {failed && logs && (
              <Box display="flex" style={{ gap: 8, marginRight: 'auto' }}>
                <Button size="small" startIcon={<Copy size={14} strokeWidth={1.5} />} onClick={copy}>
                  Copy log
                </Button>
                <Button size="small" startIcon={<Download size={14} strokeWidth={1.5} />} onClick={save}>
                  Download log (.txt)
                </Button>
              </Box>
            )}
            <Button onClick={onClose}>Close</Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
