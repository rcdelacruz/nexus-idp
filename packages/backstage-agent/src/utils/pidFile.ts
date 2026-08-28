/**
 * PID file helpers shared by the stop/logout commands.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export function getPidFilePath(): string {
  return path.join(os.homedir(), '.backstage-agent', 'agent.pid');
}

/**
 * The daemon's own SIGTERM handler (Agent.ts) also removes its PID file on shutdown, guarded
 * with an existsSync check first. Callers that unlink it themselves after signalling SIGTERM
 * race that handler — whichever loses gets an unhandled ENOENT that surfaces as a scary
 * "Failed to stop agent" / "Failed to logout" error immediately after a "stopped successfully"
 * message, even though the stop had already succeeded (found 2026-07-26). Always use this
 * instead of a bare fs.unlinkSync(pidFile).
 */
export function safeUnlinkPidFile(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}
