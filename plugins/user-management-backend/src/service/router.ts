import { Router, Request, Response, NextFunction } from 'express';
import express from 'express';
import {
  LoggerService,
  HttpAuthService,
  UserInfoService,
} from '@backstage/backend-plugin-api';
import { InputError, NotAllowedError } from '@backstage/errors';
import { UserStore } from '../database/UserStore';
import { RevocationStore } from '../database/RevocationStore';

export interface RouterOptions {
  logger: LoggerService;
  httpAuth: HttpAuthService;
  userInfo: UserInfoService;
  userStore: UserStore;
  revocationStore: RevocationStore;
  orgDomain: string;
  /** organization.githubOwner — refused as a user's linked account. */
  githubOwner?: string;
}

// Verifies the OAuth token actually belongs to the stated GitHub account.
// The user is already authenticated via Backstage (subject to the configured allowed domain) — we only
// need to confirm they own this GitHub account, not re-verify their email.
async function verifyGitHubTokenOwner(
  githubUsername: string,
  oauthToken: string,
): Promise<void> {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${oauthToken}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });
  if (!res.ok) {
    throw new Error('Could not verify GitHub account. Please try again.');
  }
  const data = (await res.json()) as { login: string };
  if (data.login.toLowerCase() !== githubUsername.toLowerCase()) {
    throw new NotAllowedError(
      `Token belongs to GitHub account '${data.login}', not '${githubUsername}'. Please connect your own GitHub account.`,
    );
  }
}

// Verifies the OAuth token actually belongs to the stated GitLab account.
// Mirrors verifyGitHubTokenOwner — we only need to confirm account ownership,
// the user is already authenticated via Backstage (subject to the configured allowed domain).
async function verifyGitLabTokenOwner(
  gitlabUsername: string,
  oauthToken: string,
): Promise<void> {
  const res = await fetch('https://gitlab.com/api/v4/user', {
    headers: { Authorization: `Bearer ${oauthToken}` },
  });
  if (!res.ok) {
    throw new Error('Could not verify GitLab account. Please try again.');
  }
  const data = (await res.json()) as { username: string };
  if (data.username.toLowerCase() !== gitlabUsername.toLowerCase()) {
    throw new NotAllowedError(
      `Token belongs to GitLab account '${data.username}', not '${gitlabUsername}'. Please connect your own GitLab account.`,
    );
  }
}

// In Express 4, async route handlers do not automatically pass thrown errors to
// the error middleware — they become unhandled rejections. This wrapper fixes that.
const wrap = (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

async function verifyGitHubOrgEmail(
  githubUsername: string,
  githubToken: string,
  orgDomain: string,
): Promise<void> {
  const res = await fetch(`https://api.github.com/users/${encodeURIComponent(githubUsername)}`, {
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });

  if (res.status === 404) {
    throw new InputError(`GitHub user '${githubUsername}' not found`);
  }
  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status}`);
  }

  const data = (await res.json()) as { email?: string | null; login: string };

  if (!data.email) {
    throw new InputError(
      `GitHub user '${githubUsername}' has no public email. ` +
      `Please set your @${orgDomain} email as your public GitHub email first.`,
    );
  }

  if (!data.email.toLowerCase().endsWith(`@${orgDomain}`)) {
    throw new NotAllowedError(
      `GitHub account '${githubUsername}' has public email '${data.email}', ` +
      `which is not a @${orgDomain} address. Please use your company GitHub account.`,
    );
  }
}

// Teams a person may pick for themselves at sign-up (POST /register). Everything else (department teams) is assigned by an admin
// (POST /assign). Keep in step with DEPT_TEAMS in plugins/onboarding OnboardingPage.tsx; the backend must enforce this, the UI
// only hides the other choices (audit 2026-11-07: any new hire could post {"team":"cloud-team"} and get that team's rights).
const SELF_REGISTER_TEAMS = ['general-engineers'];

const AUTO_LINK_MAX = 5;
const AUTO_LINK_WINDOW_MS = 10 * 60 * 1000;
const autoLinkAttempts = new Map<string, number[]>();

/** At most AUTO_LINK_MAX auto-link searches per person per window (in memory: one portal replica). Exported for tests. */
export function allowAutoLinkAttempt(name: string, now: number = Date.now()): boolean {
  const recent = (autoLinkAttempts.get(name) ?? []).filter(t => now - t < AUTO_LINK_WINDOW_MS);
  if (recent.length >= AUTO_LINK_MAX) {
    autoLinkAttempts.set(name, recent);
    return false;
  }
  recent.push(now);
  autoLinkAttempts.set(name, recent);
  return true;
}

const DEPT_TEAMS = ['general-engineers', 'web-team', 'mobile-team', 'data-team', 'cloud-team', 'ai-team', 'qa-team', 'pm-team', 'sa-team'];

// Only users authenticated via Google OAuth with the org domain are issued tokens by Backstage.
// As an extra defense-in-depth check, we validate the userEntityRef namespace and name format.
function assertOrgUser(userEntityRef: string, orgDomain: string): string {
  // Expected format: "user:default/firstname.lastname"
  const match = userEntityRef.match(/^user:default\/([a-z0-9._-]+)$/i);
  if (!match) {
    throw new NotAllowedError(`Only @${orgDomain} users may register`);
  }
  return match[1].toLowerCase();
}

export async function createRouter(options: RouterOptions): Promise<Router> {
  const { logger, httpAuth, userInfo, userStore, revocationStore, orgDomain, githubOwner } = options;
  /** The organization's own account owns every portal-created repo; GitHub refuses it as a collaborator. */
  const isOrgAccount = (username: string) => !!githubOwner && username.trim().toLowerCase() === githubOwner.toLowerCase();
  const orgAccountMessage = (username: string) =>
    `'${username}' is the organization's own GitHub account, not yours: repos the portal creates for you can't be shared with it. ` +
    `Sign in to github.com with your personal GitHub account (sign out of '${username}' first), then connect again.`;
  // integrations.github is an array — Backstage ConfigReader doesn't support [0] bracket syntax.
  // The config value `${GITHUB_TOKEN}` resolves from the same env var, so read it directly.
  const githubToken = process.env.GITHUB_TOKEN ?? '';

  const router = Router();
  router.use(express.json());

  // ── Health ────────────────────────────────────────────────────────────────
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // ── GET /me ───────────────────────────────────────────────────────────────
  // Any authenticated user: returns their own record from DB (fast, no catalog sync needed).
  router.get('/me', wrap(async (req: Request, res: Response) => {
    const credentials = await httpAuth.credentials(req as any, { allow: ['user'] });
    const info = await userInfo.getUserInfo(credentials);
    const name = assertOrgUser(info.userEntityRef, orgDomain);
    const user = await userStore.getByName(name);
    res.json({ user: user ?? null });
  }));

  // ── GET /users ────────────────────────────────────────────────────────────
  // Admin-only: list all users from the DB.
  router.get('/users', wrap(async (req: Request, res: Response) => {
    const credentials = await httpAuth.credentials(req as any, { allow: ['user'] });
    const info = await userInfo.getUserInfo(credentials);

    const isAdmin = info.ownershipEntityRefs.includes('group:default/backstage-admins');
    if (!isAdmin) {
      throw new NotAllowedError('Only platform admins can list users');
    }

    const users = await userStore.getAll();
    res.json({ users });
  }));

  // ── POST /register ────────────────────────────────────────────────────────
  // Any authenticated user in the configured domain self-registers.
  // Body: { displayName: string; team: string }
  router.post('/register', wrap(async (req: Request, res: Response) => {
    const credentials = await httpAuth.credentials(req as any, { allow: ['user'] });
    const info = await userInfo.getUserInfo(credentials);

    const name = assertOrgUser(info.userEntityRef, orgDomain);
    const email = `${name}@${orgDomain}`;

    const { displayName, team } = req.body as {
      displayName?: string;
      team?: string;
    };

    if (!team || !SELF_REGISTER_TEAMS.includes(team)) {
      throw new InputError(`Invalid team. You can register as: ${SELF_REGISTER_TEAMS.join(', ')}. An admin assigns department teams.`);
    }

    logger.info(`User ${name} self-registering to team ${team}`);

    await userStore.upsert({
      name,
      displayName: displayName ?? name,
      email,
      teams: [team],
    });

    res.json({ ok: true, message: `Registered to ${team}. Your profile will be ready within a minute.` });
  }));

  // ── POST /auto-link-github ────────────────────────────────────────────────
  // Searches GitHub for the authenticated user's org email and auto-links
  // if exactly one account is found. Returns { found: true, username } or { found: false }.
  router.post('/auto-link-github', wrap(async (req: Request, res: Response) => {
    const credentials = await httpAuth.credentials(req as any, { allow: ['user'] });
    const info = await userInfo.getUserInfo(credentials);

    const name = assertOrgUser(info.userEntityRef, orgDomain);
    const email = `${name}@${orgDomain}`;

    // Each call spends the portal's shared GitHub token (5000 requests an hour, also used by catalog discovery and scaffolding):
    // a few attempts per person is plenty, since the answer for one person does not change from one call to the next.
    if (!allowAutoLinkAttempt(name)) {
      throw new NotAllowedError('Too many attempts. Try again in a few minutes.');
    }

    if (!githubToken) {
      res.json({ found: false });
      return;
    }

    const searchRes = await fetch(
      `https://api.github.com/search/users?q=${encodeURIComponent(email)}+in:email&per_page=5`,
      { headers: { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github.v3+json' } },
    );

    if (!searchRes.ok) {
      logger.warn(`GitHub search for ${email} returned ${searchRes.status}`);
      res.json({ found: false });
      return;
    }

    const searchData = (await searchRes.json()) as {
      total_count: number;
      items: Array<{ login: string }>;
    };

    if (searchData.total_count !== 1 || searchData.items.length !== 1) {
      logger.info(`Auto-link: ${searchData.total_count} GitHub accounts found for ${email} — manual entry required`);
      res.json({ found: false });
      return;
    }

    const githubUsername = searchData.items[0].login;
    if (isOrgAccount(githubUsername)) {
      res.json({ found: false });
      return;
    }

    // Double-check the found account's public email matches the configured org domain
    try {
      await verifyGitHubOrgEmail(githubUsername, githubToken, orgDomain);
    } catch {
      logger.info(`Auto-link: GitHub user ${githubUsername} email verification failed for ${email}`);
      res.json({ found: false });
      return;
    }

    await userStore.updateGithubUsername(name, githubUsername, orgDomain);
    logger.info(`Auto-linked GitHub ${githubUsername} for user ${name}`);
    res.json({ found: true, username: githubUsername });
  }));

  // ── POST /link-github ─────────────────────────────────────────────────────
  // Any authenticated user links their GitHub username.
  // Body: { githubUsername: string }
  router.post('/link-github', wrap(async (req: Request, res: Response) => {
    const credentials = await httpAuth.credentials(req as any, { allow: ['user'] });
    const info = await userInfo.getUserInfo(credentials);

    const name = assertOrgUser(info.userEntityRef, orgDomain);
    const { githubUsername, oauthToken } = req.body as {
      githubUsername?: string;
      oauthToken?: string;
    };

    if (!githubUsername?.trim()) {
      throw new InputError('githubUsername is required');
    }
    if (isOrgAccount(githubUsername)) {
      throw new InputError(orgAccountMessage(githubUsername.trim()));
    }

    // The proof is mandatory: the token must belong to the account being linked. The fallback that used to run without it only checked
    // that the CLAIMED account's public email was on the company domain, which says nothing about who is asking: anyone could link a
    // colleague's account (and the lab form then shares their repos with that colleague), and each attempt spent the portal's GitHub token.
    if (!oauthToken) {
      throw new InputError('Sign in with GitHub to link your account (the portal needs proof that the account is yours).');
    }
    // verify the token actually belongs to this GitHub account (read:user only)
    await verifyGitHubTokenOwner(githubUsername.trim(), oauthToken);

    logger.info(`User ${name} linking GitHub username: ${githubUsername}`);

    await userStore.updateGithubUsername(name, githubUsername.trim(), orgDomain);

    res.json({ ok: true, message: 'GitHub account linked. Your profile will update within a minute.' });
  }));

  // ── POST /link-gitlab ─────────────────────────────────────────────────────
  // Any authenticated user links their GitLab username via OAuth (unlike GitHub,
  // linking is optional — only required if a trainee picks the GitLab CI track).
  // Body: { gitlabUsername: string, oauthToken?: string }
  router.post('/link-gitlab', wrap(async (req: Request, res: Response) => {
    const credentials = await httpAuth.credentials(req as any, { allow: ['user'] });
    const info = await userInfo.getUserInfo(credentials);

    const name = assertOrgUser(info.userEntityRef, orgDomain);
    const { gitlabUsername, oauthToken } = req.body as {
      gitlabUsername?: string;
      oauthToken?: string;
    };

    if (!gitlabUsername?.trim()) {
      throw new InputError('gitlabUsername is required');
    }

    if (!oauthToken) {
      throw new InputError('Sign in with GitLab to link your account (the portal needs proof that the account is yours).');
    }
    await verifyGitLabTokenOwner(gitlabUsername.trim(), oauthToken);

    logger.info(`User ${name} linking GitLab username: ${gitlabUsername}`);

    await userStore.updateGitlabUsername(name, gitlabUsername.trim(), orgDomain);

    res.json({ ok: true, message: 'GitLab account linked.' });
  }));

  // ── POST /onboarding-step ──────────────────────────────────────────────────
  // Any authenticated user marks their own onboarding step as done/undone.
  // Body: { step: 'catalog_tour' | 'engineering_docs'; done: boolean }
  router.post('/onboarding-step', wrap(async (req: Request, res: Response) => {
    const credentials = await httpAuth.credentials(req as any, { allow: ['user'] });
    const info = await userInfo.getUserInfo(credentials);
    const name = assertOrgUser(info.userEntityRef, orgDomain);

    const { step, done } = req.body;
    if (!['catalog_tour', 'engineering_docs'].includes(step)) {
      throw new InputError(`Invalid step: ${step}. Must be 'catalog_tour' or 'engineering_docs'.`);
    }
    if (typeof done !== 'boolean') {
      throw new InputError('done must be a boolean');
    }

    await userStore.updateOnboardingStep(name, step, done);
    logger.info(`User ${name} marked onboarding step '${step}' as ${done ? 'done' : 'undone'}`);
    res.json({ ok: true });
  }));

  // ── POST /assign ──────────────────────────────────────────────────────────
  // Admin-only: assign any user to a team.
  // Body: { userName: string; teams: string[]; isLead?: boolean; displayName?: string; email?: string }
  router.post('/assign', wrap(async (req: Request, res: Response) => {
    const credentials = await httpAuth.credentials(req as any, { allow: ['user'] });
    const info = await userInfo.getUserInfo(credentials);

    const isAdmin = info.ownershipEntityRefs.includes('group:default/backstage-admins');
    if (!isAdmin) {
      throw new NotAllowedError('Only platform admins can assign users to teams');
    }

    const { userName, teams, isLead, displayName, email } = req.body as {
      userName?: string;
      teams?: string[];
      isLead?: boolean;
      displayName?: string;
      email?: string;
    };

    if (!userName) throw new InputError('userName is required');
    if (!teams?.length) throw new InputError('teams must be a non-empty array');
    for (const t of teams) {
      if (!DEPT_TEAMS.includes(t)) throw new InputError(`Invalid team: ${t}`);
    }

    logger.info(`Admin ${info.userEntityRef} assigning ${userName} to [${teams.join(', ')}]`);

    await userStore.upsert({
      name: userName,
      displayName: displayName ?? userName,
      email: email ?? `${userName}@${orgDomain}`,
      teams,
      isLead,
    });
    // Their token still carries the old groups: refuse it so the next request needs a fresh sign-in (which has the new ones).
    await revocationStore.invalidateSessionsBefore(`user:default/${userName}`);

    res.json({ ok: true, message: `${userName} assigned to [${teams.join(', ')}].` });
  }));

  // Body: { userName: string; isAdmin: boolean }
  router.post('/promote', wrap(async (req: Request, res: Response) => {
    const credentials = await httpAuth.credentials(req as any, { allow: ['user'] });
    const info = await userInfo.getUserInfo(credentials);

    const isAdmin = info.ownershipEntityRefs.includes('group:default/backstage-admins');
    if (!isAdmin) {
      throw new NotAllowedError('Only platform admins can promote or demote users');
    }

    const { userName, isAdmin: makeAdmin } = req.body as {
      userName?: string;
      isAdmin?: boolean;
    };

    if (!userName) throw new InputError('userName is required');
    if (typeof makeAdmin !== 'boolean') throw new InputError('isAdmin must be a boolean');

    // Prevent self-demotion — admins cannot remove their own admin role
    const callerName = info.userEntityRef.split('/').pop();
    if (!makeAdmin && callerName === userName) {
      throw new NotAllowedError('You cannot remove your own admin role');
    }

    const user = await userStore.getByName(userName);
    if (!user) throw new InputError(`User '${userName}' not found`);

    await userStore.setAdmin(userName, makeAdmin);
    // A demoted admin's token still says admin for the rest of its life: refuse it, so the change takes effect on the next request.
    await revocationStore.invalidateSessionsBefore(`user:default/${userName}`);

    const action = makeAdmin ? 'promoted to admin' : 'demoted from admin';
    logger.info(`Admin ${info.userEntityRef} ${action}: ${userName}`);
    res.json({ ok: true, message: `${user.display_name} has been ${action}.` });
  }));

  // ── POST /instructor ──────────────────────────────────────────────────────
  // Admin-only: grant or revoke the instructor role (membership of the `instructors` group,
  // synced to the catalog by UserEntityProvider). Independent of the user's department team.
  // Body: { userName: string; isInstructor: boolean }
  router.post('/instructor', wrap(async (req: Request, res: Response) => {
    const credentials = await httpAuth.credentials(req as any, { allow: ['user'] });
    const info = await userInfo.getUserInfo(credentials);

    const isAdmin = info.ownershipEntityRefs.includes('group:default/backstage-admins');
    if (!isAdmin) {
      throw new NotAllowedError('Only platform admins can grant or revoke the instructor role');
    }

    const { userName, isInstructor } = req.body as {
      userName?: string;
      isInstructor?: boolean;
    };

    if (!userName) throw new InputError('userName is required');
    if (typeof isInstructor !== 'boolean') throw new InputError('isInstructor must be a boolean');

    const user = await userStore.getByName(userName);
    if (!user) throw new InputError(`User '${userName}' not found`);

    // A row with no team that is not an admin is a "ghost" (linked GitHub before finishing
    // onboarding). UserEntityProvider deliberately emits no catalog entity for it, so a role
    // granted to it could never take effect: refuse the GRANT instead of saving a flag that does
    // nothing. Revoking is always allowed: an admin with no team who was made an instructor and
    // then demoted is exactly such a row, still emitted because of the flag, and must be removable.
    if (isInstructor && user.teams.length === 0 && !user.is_admin) {
      throw new InputError(`${user.display_name} has not finished onboarding yet. Ask them to complete it first.`);
    }

    await userStore.setInstructor(userName, isInstructor);
    await revocationStore.invalidateSessionsBefore(`user:default/${userName}`);

    const action = isInstructor ? 'is now an instructor' : 'is no longer an instructor';
    logger.info(`Admin ${info.userEntityRef} ${isInstructor ? 'made' : 'removed'} instructor: ${userName}`);
    res.json({ ok: true, message: `${user.display_name} ${action}.` });
  }));

  // DELETE /users/:name
  router.delete('/users/:name', wrap(async (req: Request, res: Response) => {
    const credentials = await httpAuth.credentials(req as any, { allow: ['user'] });
    const info = await userInfo.getUserInfo(credentials);

    const isAdmin = info.ownershipEntityRefs.includes('group:default/backstage-admins');
    if (!isAdmin) {
      throw new NotAllowedError('Only platform admins can remove users');
    }

    const { name } = req.params;

    // Prevent self-deletion
    const callerName = info.userEntityRef.split('/').pop();
    if (callerName === name) {
      throw new NotAllowedError('You cannot remove your own account');
    }

    const user = await userStore.getByName(name);
    if (!user) throw new InputError(`User '${name}' not found`);

    // Revoke their session BEFORE deleting — blocks all active requests immediately.
    await revocationStore.revoke(`user:default/${name}`);
    await userStore.delete(name);

    logger.info(`Admin ${info.userEntityRef} removed user: ${name} (session revoked)`);
    res.json({ ok: true, message: `${user.display_name} has been removed.` });
  }));

  // Convert thrown errors (InputError, NotAllowedError, etc.) to proper HTTP responses.
  // In Express 4, async handlers don't pass errors automatically — wrap() calls next(err)
  // which reaches this handler.
  router.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    let status: number;
    if (err.name === 'NotAllowedError') { status = 403; }
    else if (err.name === 'InputError') { status = 400; }
    else { status = 500; }
    res.status(status).json({ error: err.message ?? 'Internal server error' });
  });

  return router;
}
