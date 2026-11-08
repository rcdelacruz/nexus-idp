import React, { useState } from 'react';
import { Button, Typography } from '@material-ui/core';
import { FileText, Play } from 'lucide-react';
import { alertApiRef, useApi } from '@backstage/core-plugin-api';
import { localProvisionerApiRef } from '../../api/LocalProvisionerClient';
import { checkSummary } from '../../api/checkSummary';
import { TraineeCheck, TraineeRow } from '../../api/types';
import { CheckDetailsDialog } from '../CheckDetails/CheckDetailsDialog';
import { relativeTime } from './helpers';
import { usePageStyles } from './pageStyles';
import { useStyles } from './styles';

/** The instructor checks of a capstone: Run, the latest result of each, and a Details popup for it. */
export function LabChecks({ row, onChanged }: { row: TraineeRow; onChanged: () => void }) {
  const classes = useStyles();
  const p = usePageStyles();
  const api = useApi(localProvisionerApiRef);
  const alertApi = useApi(alertApiRef);
  const c = row.capstone;
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState<{ check: TraineeCheck; title: string } | null>(null);

  const runCheck = async (name: string) => {
    setBusy(true);
    try {
      await api.runCapstoneCheck(c!.id, name);
      alertApi.post({ message: 'Check sent to the trainee\'s agent — the result appears here when it reports', severity: 'info', display: 'transient' });
      onChanged();
    } catch (e: any) {
      alertApi.post({ message: `Check not started: ${e.message}`, severity: 'error' });
    } finally {
      setBusy(false);
    }
  };

  if (!c || (c.availableChecks ?? []).length === 0) {
    return <Typography className={classes.muted}>This lab has no instructor checks.</Typography>;
  }

  return (
    <>
      {(c.availableChecks ?? []).map(chk => {
        const last = (row.checks ?? []).find(r => r.name === chk.name);
        const running = last && (last.status === 'pending' || last.status === 'in-progress');
        return (
          <div key={chk.name} className={p.check}>
            <div className={p.checkText}>
              <Typography variant="body2" style={{ fontWeight: 600 }}>
                {chk.title}
              </Typography>
              <span className={p.sub}>{last ? `${checkSummary(last)} · ${relativeTime(last.at)}` : 'Not run yet'}</span>
            </div>
            <div className={p.checkButtons}>
              <Button
                variant="outlined"
                startIcon={<Play size={16} strokeWidth={1.5} />}
                disabled={busy || row.environment.state !== 'running' || c.awaitingSeedReport}
                aria-label={`Run ${chk.title}`}
                onClick={() => runCheck(chk.name)}
              >
                Run
              </Button>
              {last && !running && (
                <Button variant="outlined" startIcon={<FileText size={16} strokeWidth={1.5} />} aria-label={`Details of ${chk.title}`} onClick={() => setDetails({ check: last, title: chk.title })}>
                  Details
                </Button>
              )}
            </div>
          </div>
        );
      })}
      <CheckDetailsDialog check={details?.check ?? null} title={details?.title ?? ''} traineeEmail={row.traineeEmail} onClose={() => setDetails(null)} />
    </>
  );
}
