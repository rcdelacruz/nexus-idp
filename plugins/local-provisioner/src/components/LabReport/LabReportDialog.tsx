import React from 'react';
import { Button, Dialog, DialogActions, DialogContent } from '@material-ui/core';
import { Download } from 'lucide-react';
import { LabReport, reportFileName, reportJson } from '../../api/labReport';
import { downloadFile } from '../../api/download';
import { LabReportView, REPORT_CSS, reportHtmlDocument } from './LabReportView';

/** The report on screen, with the two ways to take it away: a standalone page (print it to PDF from the browser) and the data. */
export const LabReportDialog = ({ report, onClose }: { report: LabReport | null; onClose: () => void }) => (
  <Dialog open={!!report} onClose={onClose} fullWidth maxWidth="md" scroll="paper" aria-label="Lab report">
    <DialogContent dividers>
      {report && (
        <>
          <style>{REPORT_CSS}</style>
          <LabReportView report={report} />
        </>
      )}
    </DialogContent>
    <DialogActions>
      {report && (
        <>
          <Button
            startIcon={<Download size={16} strokeWidth={1.5} />}
            onClick={() => downloadFile(`${reportFileName(report)}.html`, 'text/html', reportHtmlDocument(report))}
          >
            Download report (.html)
          </Button>
          <Button startIcon={<Download size={16} strokeWidth={1.5} />} onClick={() => downloadFile(`${reportFileName(report)}.json`, 'application/json', reportJson(report))}>
            Download data (.json)
          </Button>
        </>
      )}
      <Button onClick={onClose}>Close</Button>
    </DialogActions>
  </Dialog>
);
