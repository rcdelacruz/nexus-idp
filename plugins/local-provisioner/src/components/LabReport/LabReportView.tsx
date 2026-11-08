import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LabReport } from '../../api/labReport';

/**
 * The lab report as plain HTML elements (no theme, no UI library), so the same view is shown in the dialog and rendered to a standalone
 * file. Every value is a React text node, so what a trainee wrote (commit messages, notes) can never become markup.
 */
export const REPORT_CSS = `
/* Colours come from the app theme (so the report is readable in every theme, dark ones included); the values after the commas are
   what the downloaded page uses, where there is no theme: black on white, print friendly. */
.lr { --lr-fg: var(--fg-primary, #1a1a1a); --lr-muted: var(--fg-secondary, #555555); --lr-line: var(--border, #d4d4d4); --lr-row: var(--ds-gray-alpha-300, #e5e5e5); --lr-head: var(--ds-gray-100, #f6f6f6); --lr-bad: #b42318; }
html.theme-dark .lr { --lr-bad: #ff7b72; }
.lr { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: var(--lr-fg); font-size: 14px; line-height: 1.5; max-width: 860px; margin: 0 auto; padding: 8px 4px; }
.lr h1 { font-size: 22px; margin: 0 0 2px; letter-spacing: -0.02em; }
.lr h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 1px solid var(--lr-line); }
.lr h3 { font-size: 14px; margin: 14px 0 4px; }
.lr .lr-sub { color: var(--lr-muted); margin: 0 0 12px; }
.lr table { border-collapse: collapse; width: 100%; margin: 4px 0 8px; }
.lr th, .lr td { text-align: left; vertical-align: top; padding: 4px 8px; border-bottom: 1px solid var(--lr-row); }
.lr th { font-weight: 600; background: var(--lr-head); }
.lr .lr-facts th { width: 190px; background: none; font-weight: 500; color: var(--lr-muted); }
.lr .lr-num { text-align: right; white-space: nowrap; }
.lr .lr-bad { color: var(--lr-bad); font-weight: 600; }
.lr .lr-muted { color: var(--lr-muted); }
.lr code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; }
.lr ul { margin: 4px 0 8px; padding-left: 20px; }
.lr .lr-foot { margin-top: 24px; color: var(--lr-muted); font-size: 12px; }
@media print { .lr h2 { break-after: avoid; } .lr table { break-inside: auto; } .lr tr { break-inside: avoid; } }
`;

const fmt = (iso?: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};

export function LabReportView({ report }: { report: LabReport }) {
  const { environment: env, repo } = report;
  return (
    <div className="lr">
      <h1>Lab report</h1>
      <p className="lr-sub">
        {report.trainee} · {report.course} · {report.lab}
      </p>

      <h2>Summary</h2>
      <ul>
        {report.summary.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>

      <h2>Details</h2>
      <table className="lr-facts">
        <tbody>
          <tr><th>Trainee</th><td>{report.trainee}</td></tr>
          <tr><th>Course</th><td>{report.course}</td></tr>
          {report.capstone && <tr><th>Capstone</th><td>{report.capstone.id} · trainee #{report.capstone.traineeNo} · {report.capstone.status}</td></tr>}
          <tr><th>Lab</th><td>{report.lab}</td></tr>
          <tr><th>Environment</th><td>{env.state}</td></tr>
          <tr><th>Set up</th><td>{fmt(env.startedAt)}</td></tr>
          <tr><th>Time in the lab</th><td>{env.timeInLab ?? '—'}</td></tr>
          <tr><th>Last change</th><td>{fmt(env.lastChangeAt)}</td></tr>
        </tbody>
      </table>

      <h2>Repository</h2>
      {repo ? (
        <table className="lr-facts">
          <tbody>
            <tr><th>Repository</th><td>{repo.url}</td></tr>
            <tr><th>Commits</th><td>{repo.commits} in total, {repo.commitsLast14Days} in the last 14 days</td></tr>
            {repo.lastCommit && (
              <tr>
                <th>Last commit</th>
                <td>
                  <code>{repo.lastCommit.sha}</code> {repo.lastCommit.message} <span className="lr-muted">· {repo.lastCommit.author} · {fmt(repo.lastCommit.date)}</span>
                </td>
              </tr>
            )}
            <tr><th>Stage files worked on</th><td>{repo.stageFiles.length ? repo.stageFiles.join(', ') : 'None yet'}</td></tr>
            {repo.progress && <tr><th>Progress</th><td>{repo.progress.done} of {repo.progress.total} tasks</td></tr>}
            <tr><th>AI logs / corrections / decisions</th><td>{repo.aiLogFiles} / {repo.corrections} / {repo.decisions}</td></tr>
            <tr><th>Pull requests</th><td>{repo.pullRequests.open} open, {repo.pullRequests.merged} merged</td></tr>
            {repo.ci && <tr><th>Latest CI run</th><td>{repo.ci.status === 'completed' ? repo.ci.conclusion ?? 'unknown' : repo.ci.status}</td></tr>}
          </tbody>
        </table>
      ) : (
        <p className="lr-muted">{report.repoNote ?? 'No repository.'}</p>
      )}

      <h2>Checks and grades</h2>
      {report.checks.length === 0 && <p className="lr-muted">No checks or grades have been run yet.</p>}
      {report.checks.map((c, i) => (
        <div key={i}>
          <h3>
            {c.name} <span className="lr-muted">· {fmt(c.at)}</span>
          </h3>
          <p>{c.summary}</p>
          {c.grade && (
            <>
              <table>
                <thead>
                  <tr><th>Area</th><th>Item</th><th className="lr-num">Points</th><th className="lr-num">Got</th><th>Detail</th></tr>
                </thead>
                <tbody>
                  {c.grade.items.map(item => (
                    <tr key={item.id}>
                      <td>{item.area ?? ''}</td>
                      <td>{item.title}</td>
                      <td className="lr-num">{item.points}</td>
                      <td className="lr-num">{item.got}</td>
                      <td className="lr-muted">{item.detail ?? ''}</td>
                    </tr>
                  ))}
                  <tr>
                    <th colSpan={2}>Automated total</th>
                    <th className="lr-num">{c.grade.maxPoints}</th>
                    <th className="lr-num">{c.grade.autoTotal}</th>
                    <th />
                  </tr>
                </tbody>
              </table>
              {c.grade.hardFails.length > 0 && (
                <>
                  <p className="lr-bad">Hard fails</p>
                  <ul>{c.grade.hardFails.map((h, k) => <li key={k} className="lr-bad">{h}</li>)}</ul>
                </>
              )}
              {c.grade.manual.length > 0 && (
                <>
                  <p>Graded by hand</p>
                  <ul>{c.grade.manual.map((m, k) => <li key={k}>{m}</li>)}</ul>
                </>
              )}
              {c.grade.notes.length > 0 && (
                <>
                  <p>Notes</p>
                  <ul>{c.grade.notes.map((n, k) => <li key={k}>{n}</li>)}</ul>
                </>
              )}
            </>
          )}
        </div>
      ))}

      <h2>Environment history</h2>
      <table>
        <thead>
          <tr><th>When</th><th>What</th><th>Result</th></tr>
        </thead>
        <tbody>
          {report.history.map((e, i) => (
            <tr key={i}><td>{fmt(e.at)}</td><td>{e.type}</td><td>{e.status}</td></tr>
          ))}
        </tbody>
      </table>

      <p className="lr-foot">Generated {fmt(report.generatedAt)} by the Nexus IDP Local Provisioner.</p>
    </div>
  );
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** The whole report as one self-contained HTML page: save it, email it, or print it to PDF from any browser. */
export function reportHtmlDocument(report: LabReport): string {
  const body = renderToStaticMarkup(<LabReportView report={report} />);
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${escapeHtml(`Lab report - ${report.trainee} - ${report.lab}`)}</title><style>${REPORT_CSS}\nbody { margin: 24px; background: #ffffff; }</style></head><body>${body}</body></html>\n`;
}
