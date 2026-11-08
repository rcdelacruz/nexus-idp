import React, { useState } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@material-ui/core';
import { ExternalLink, Eye, Send } from 'lucide-react';
import { MarkdownContent } from '@backstage/core-components';
import { alertApiRef, useApi } from '@backstage/core-plugin-api';
import { localProvisionerApiRef } from '../../api/LocalProvisionerClient';
import { CapstoneSecrets, TraineeRow } from '../../api/types';
import { relativeTime } from './helpers';
import { usePageStyles } from './pageStyles';
import { useStyles } from './styles';

/** Capstone actions for instructors: the handout PR (Day-4 sabotage or a client change request) and the instructor-only seed data. */
export function CapstoneActions({ row, onChanged }: { row: TraineeRow; onChanged: () => void }) {
  const classes = useStyles();
  const p = usePageStyles();
  const api = useApi(localProvisionerApiRef);
  const alertApi = useApi(alertApiRef);
  const c = row.capstone!;
  const handout = c.handout ?? {
    label: 'Day-4 handout',
    instructions: "Opens the sabotaged pull request on the trainee's repository, as the instructor guide describes. Don't tell the trainee it's a test. Running it again reuses the same branch and PR.",
  };
  const [confirmHandout, setConfirmHandout] = useState(false);
  const [busy, setBusy] = useState(false);
  const [secrets, setSecrets] = useState<CapstoneSecrets | null>(null);

  const sendHandout = async () => {
    setBusy(true);
    try {
      const r = await api.openCapstoneHandout(c.id);
      alertApi.post({ message: r.created ? `${handout.label} PR opened` : `${handout.label} PR was already open`, severity: 'success', display: 'transient' });
      onChanged();
    } catch (e: any) {
      alertApi.post({ message: `Handout failed: ${e.message}`, severity: 'error' });
    } finally {
      setBusy(false);
      setConfirmHandout(false);
    }
  };
  const reveal = async () => {
    try {
      setSecrets(await api.getCapstoneSecrets(c.id));
    } catch (e: any) {
      alertApi.post({ message: e.message, severity: 'error' });
    }
  };

  return (
    <>
      <div className={p.section}>
        <div className={p.sectionTitle}>Capstone</div>
        <div className={p.kv}>
          <span className={p.kvKey}>Capstone</span>
          <span className={p.kvValue}>
            {c.capstone} · trainee #{c.traineeNo}
          </span>
        </div>
        <div className={p.kv}>
          <span className={p.kvKey}>Status</span>
          <span className={p.kvValue}>{c.status}</span>
        </div>
        {(c.awaitingSeedReport || c.seedReportedAt) && (
          <div className={p.kv}>
            <span className={p.kvKey}>Seed</span>
            <span className={p.kvValue}>
              {c.awaitingSeedReport ? 'waiting for the trainee\'s lab to seed and report' : `reported by the trainee's laptop ${relativeTime(c.seedReportedAt)} (unverified)`}
            </span>
          </div>
        )}
        <div className={p.kv}>
          <span className={p.kvKey}>{handout.label}</span>
          <span className={p.kvValue}>
            {c.handoutPrUrl ? (
              <a href={c.handoutPrUrl} target="_blank" rel="noopener noreferrer">
                PR opened {relativeTime(c.handoutAt)} <ExternalLink size={12} strokeWidth={1.5} aria-hidden="true" />
              </a>
            ) : (
              'not sent'
            )}
          </span>
        </div>
      </div>
      <div className={p.actions}>
        <Button variant="outlined" startIcon={<Send size={16} strokeWidth={1.5} />} disabled={!row.repoUrl || busy} onClick={() => setConfirmHandout(true)}>
          {c.handoutPrUrl ? `Re-send ${handout.label}` : `Send ${handout.label}`}
        </Button>
        <Button variant="outlined" startIcon={<Eye size={16} strokeWidth={1.5} />} disabled={c.awaitingSeedReport} onClick={reveal}>
          Instructor data
        </Button>
      </div>

      <Dialog open={confirmHandout} onClose={() => setConfirmHandout(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Send the {handout.label}?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {row.traineeEmail}: {handout.instructions}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmHandout(false)}>Cancel</Button>
          <Button color="primary" variant="contained" disabled={busy} onClick={sendHandout}>
            Open PR
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(secrets)} onClose={() => setSecrets(null)} maxWidth="md" fullWidth>
        <DialogTitle>Instructor data: {row.traineeEmail} (#{c.traineeNo})</DialogTitle>
        <DialogContent>
          <Typography className={classes.muted}>
            Instructor-only. Never paste this into chat or a ticket the trainee (or an AI agent) can read. Viewing it is logged.
          </Typography>
          <div className={classes.sectionLabel}>Seeded credentials</div>
          <pre className={classes.pre}>{secrets?.credentials}</pre>
          <div className={classes.sectionLabel}>Handover answer key</div>
          <div className={classes.markdown} data-testid="answer-key">
            <MarkdownContent content={secrets?.answerKey ?? ''} dialect="gfm" />
          </div>
          <div className={classes.sectionLabel}>Grading</div>
          <Typography variant="body2">
            Save the manifest below as <code>manifest.json</code> and the credentials as <code>credentials.txt</code>, clone the
            trainee repo, then run from the capstone repo:
          </Typography>
          <pre className={classes.pre}>{secrets?.gradeCommand}</pre>
          <div className={classes.sectionLabel}>Seed manifest</div>
          <pre className={classes.pre}>{secrets ? JSON.stringify(secrets.seedManifest, null, 2) : ''}</pre>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSecrets(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
