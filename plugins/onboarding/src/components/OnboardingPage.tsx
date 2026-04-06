import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useApi, identityApiRef, githubAuthApiRef, configApiRef } from '@backstage/core-plugin-api';
import { Page, Header, Content } from '@backstage/core-components';
import {
  Box, CircularProgress, LinearProgress, MenuItem, Select, TextField, Typography,
} from '@material-ui/core';
import {
  AlertCircle, CheckCircle, Circle, ExternalLink,
  LayoutGrid, BookOpen, Loader, User, GitBranch,
} from 'lucide-react';
import { useColors, semantic, badge } from '@stratpoint/theme-utils';
import { userManagementApiRef } from '../api/refs';

export { DEPT_TEAM_IDS, DEPT_TEAM_IDS_JWT } from '../constants';

const DEPT_TEAMS: Record<string, string> = {
  'general-engineers': 'No team yet — Intern / Trainee',
  'web-team': 'Web',
  'mobile-team': 'Mobile',
  'data-team': 'Data',
  'cloud-team': 'Cloud',
  'ai-team': 'AI',
  'qa-team': 'QA',
  'pm-team': 'PM',
  'sa-team': 'SolArch',
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StepCardProps { step: Step; isLast: boolean; }
export interface RegistrationFormProps { identity: ReturnType<typeof useIdentity>; onRegistered: () => void; }

// ── Onboarding progress ──────────────────────────────────────────────────────
// Steps 1 (register) and 2 (github) are derived from DB fields (teams, github_username).
// Steps 3 (catalog-tour) and 4 (engineering-docs) are stored in DB columns.
// The __registered flag is session-only (localStorage) to bridge the gap between
// form submit and the next DB poll confirming team assignment.

function useProgress(userRef: string, api: { markOnboardingStep: (step: 'catalog_tour' | 'engineering_docs', done: boolean) => Promise<any> }) {
  const [data, setData] = useState<Record<string, boolean>>({});

  // Load __registered flag from localStorage (session-only)
  useEffect(() => {
    if (!userRef) return;
    try {
      const saved = JSON.parse(localStorage.getItem(`onboarding_v1_${userRef}`) ?? '{}');
      setData(prev => ({ ...prev, __registered: saved.__registered ?? false }));
    } catch { /* intentional */ }
  }, [userRef]);

  // Load DB-backed steps from getMe response
  const loadFromDb = useCallback((me: { onboarding_catalog_tour: boolean; onboarding_engineering_docs: boolean } | null) => {
    if (!me) return;
    setData(prev => ({
      ...prev,
      'catalog-tour': me.onboarding_catalog_tour,
      'engineering-docs': me.onboarding_engineering_docs,
    }));
  }, []);

  const mark = useCallback((id: string, value: boolean) => {
    if (!userRef) return;
    setData(prev => {
      const next = { ...prev, [id]: value };
      // __registered is session-only
      if (id === '__registered') {
        try { localStorage.setItem(`onboarding_v1_${userRef}`, JSON.stringify({ __registered: value })); } catch { /* intentional */ }
      }
      // DB-backed steps
      if (id === 'catalog-tour') {
        api.markOnboardingStep('catalog_tour', value).catch(() => {});
      } else if (id === 'engineering-docs') {
        api.markOnboardingStep('engineering_docs', value).catch(() => {});
      }
      return next;
    });
  }, [userRef, api]);

  const markRegistered = useCallback(() => mark('__registered', true), [mark]);
  const clearRegistered = useCallback(() => mark('__registered', false), [mark]);

  return {
    done: data,
    mark,
    loadFromDb,
    isRegistered: data.__registered ?? false,
    markRegistered,
    clearRegistered,
  };
}



// ── Identity hook ─────────────────────────────────────────────────────────────

function useIdentity() {
  const identityApi = useApi(identityApiRef);
  const [state, setState] = useState({
    userRef: '', name: '', displayName: '', email: '',
    picture: undefined as string | undefined,
    isNewUser: false, isAdmin: false, loading: true,
  });
  useEffect(() => {
    Promise.all([identityApi.getBackstageIdentity(), identityApi.getProfileInfo()])
      .then(([identity, profile]) => {
        const refs = identity.ownershipEntityRefs ?? [];
        const hasDeptTeam = refs.some(r => Object.keys(DEPT_TEAMS).some(t => r === `group:default/${t}`));
        const isAdmin = refs.some(r => r === 'group:default/backstage-admins');
        const localPart = identity.userEntityRef.split('/').pop() ?? '';
        setState({
          userRef: identity.userEntityRef,
          name: localPart,
          displayName: profile.displayName ?? localPart,
          // Always derive from the authenticated identity — never user-supplied
          email: profile.email ?? `${localPart}@unknown`,
          picture: profile.picture,
          isNewUser: !hasDeptTeam && !isAdmin,
          isAdmin,
          loading: false,
        });
      })
      .catch(() => setState(s => ({ ...s, loading: false })));
  }, [identityApi]);
  return state;
}

function useGitHubStatus(userRef: string, onMeLoaded?: (me: { onboarding_catalog_tour: boolean; onboarding_engineering_docs: boolean } | null) => void) {
  const api = useApi(userManagementApiRef);
  const [status, setStatus] = useState<'loading' | 'verified' | 'unverified' | 'no-entity'>('loading');
  const [login, setLogin] = useState<string | undefined>();
  const [isTeamAssigned, setIsTeamAssigned] = useState<boolean | undefined>(undefined);
  const onMeLoadedRef = useRef(onMeLoaded);
  onMeLoadedRef.current = onMeLoaded;

  const check = useCallback(async () => {
    let me: Awaited<ReturnType<typeof api.getMe>>;
    try {
      me = await api.getMe();
    } catch {
      return;
    }
    onMeLoadedRef.current?.(me);
    setIsTeamAssigned(me !== null && (me.teams?.length ?? 0) > 0);
    if (me?.github_username) {
      setLogin(me.github_username);
      setStatus('verified');
      return;
    }
    setStatus(me !== null ? 'unverified' : 'no-entity');
  }, [api]);

  useEffect(() => {
    if (!userRef) return undefined;
    check();
    const interval = setInterval(check, 30_000);
    return () => clearInterval(interval);
  }, [userRef, check]);

  return { status, login, refresh: check, isTeamAssigned };
}

// ── GitHub Connect Button ─────────────────────────────────────────────────────
// Uses GitHub OAuth to get the username — no manual typing needed.

const GitHubConnectButton = ({ onConnected }: { onConnected?: () => void }) => {
  const api = useApi(userManagementApiRef);
  const githubAuth = useApi(githubAuthApiRef);
  const c = useColors();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const connect = async () => {
    setLoading(true); setError('');
    try {
      // instantPopup: true opens the OAuth popup immediately without hanging.
      const token = await githubAuth.getAccessToken(['read:user'], { instantPopup: true });

      // Fetch GitHub username from the token
      const ghRes = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' },
      });
      if (!ghRes.ok) throw new Error('Could not fetch GitHub profile. Please try again.');
      const ghUser = await ghRes.json() as { login: string };

      // Save to DB (so catalog annotation gets set for other features).
      await api.linkGithub({ githubUsername: ghUser.login, oauthToken: token });
      // Immediately refresh the GitHub status so the step updates without a page reload.
      onConnected?.();
    } catch (err: any) {
      // User closed the popup — don't show an error
      if (err?.message?.includes('rejected') || err?.name === 'RejectionError') return;
      setError(err.message ?? 'Failed to connect GitHub. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
      <button
        type="button"
        onClick={connect}
        disabled={loading}
        aria-busy={loading}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '8px 16px', borderRadius: 6, cursor: loading ? 'not-allowed' : 'pointer',
          background: c.surface, border: `1px solid ${c.border}`,
          color: c.text, fontSize: '0.875rem', fontWeight: 500, width: 'fit-content',
        }}
      >
        {loading
          ? <Loader size={14} strokeWidth={1.5} aria-hidden="true" />
          : <GitBranch size={14} strokeWidth={1.5} aria-hidden="true" />}
        {loading ? 'Connecting...' : 'Connect GitHub account'}
      </button>
      {error && (
        <Box role="alert" display="flex" alignItems="center" style={{ gap: 6 }}>
          <AlertCircle size={13} color={semantic.error} strokeWidth={1.5} aria-hidden="true" />
          <Typography style={{ color: semantic.error, fontSize: '0.8125rem' }}>{error}</Typography>
        </Box>
      )}
    </Box>
  );
};


// ── Registration Form ─────────────────────────────────────────────────────────

const RegistrationForm = ({ identity, onRegistered }: RegistrationFormProps) => {
  const api = useApi(userManagementApiRef);
  // Derive domain from the authenticated email — no config needed.
  // Google OAuth already restricts sign-in to the org domain, so this is always correct.
  const orgDomain = identity.email.split('@')[1] ?? '';
  const c = useColors();
  const [team, setTeam] = useState('');
  const [displayName, setDisplayName] = useState(identity.displayName);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Validate email is an org email before even allowing submit
  const isOrgEmail = identity.email.toLowerCase().endsWith(`@${orgDomain}`);

  const submit = async () => {
    if (!isOrgEmail) { setError(`Only @${orgDomain} accounts can register.`); return; }
    if (!team) { setError('Please select your team.'); return; }
    setLoading(true); setError('');
    try {
      await api.register({ displayName, team });
      onRegistered();
    } catch (err: any) {
      setError(err.message ?? 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOrgEmail) {
    return (
      <Box role="alert" display="flex" alignItems="center" style={{ gap: 8, marginTop: 10, padding: '10px 14px', borderRadius: 6, background: semantic.errorBg, border: `1px solid ${semantic.error}33` }}>
        <AlertCircle size={14} color={semantic.error} strokeWidth={1.5} aria-hidden="true" />
        <Typography style={{ color: semantic.error, fontSize: '0.8125rem' }}>
          Only <strong>@{orgDomain}</strong> accounts can register. You are signed in as <strong>{identity.email}</strong>.
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      component="form"
      onSubmit={(e: React.FormEvent) => { e.preventDefault(); submit(); }}
      style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
      data-loading={loading}
    >
      {/* Email confirmation — read-only, proves it's their stratpoint account */}
      <Box style={{ padding: '8px 12px', borderRadius: 6, background: c.surfaceSubtle, border: `1px solid ${c.border}` }}>
        <Typography style={{ fontSize: '0.75rem', color: c.textMuted, marginBottom: 2 }}>Registering as</Typography>
        <Typography style={{ fontSize: '0.875rem', color: c.text, fontWeight: 500 }}>{identity.email}</Typography>
      </Box>

      <Box style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label htmlFor="reg-display-name" style={{ fontSize: '0.75rem', color: c.textMuted, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Display name
        </label>
        <TextField
          id="reg-display-name"
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
          variant="outlined"
          size="small"
          inputProps={{ style: { color: c.text, fontSize: '0.875rem' } }}
          style={{ background: c.inputBg, borderRadius: 6 }}
        />
      </Box>

      <Box style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label htmlFor="reg-team" style={{ fontSize: '0.75rem', color: c.textMuted, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Your team <span style={{ color: semantic.error }} aria-label="required">*</span>
        </label>
        <Select
          id="reg-team"
          value={team}
          onChange={e => setTeam(e.target.value as string)}
          displayEmpty
          variant="outlined"
          inputProps={{ id: 'reg-team', 'aria-invalid': !team && !!error, 'aria-describedby': error ? 'reg-error' : undefined }}
          style={{ background: c.inputBg, color: team ? c.text : c.textMuted, fontSize: '0.875rem' }}
        >
          <MenuItem value="" disabled><span style={{ color: c.textMuted }}>Select your department...</span></MenuItem>
          {Object.entries(DEPT_TEAMS).map(([value, label]) => (
            <MenuItem key={value} value={value}>{label}</MenuItem>
          ))}
        </Select>
      </Box>

      {error && (
        <Box id="reg-error" role="alert" display="flex" alignItems="center" style={{ gap: 6 }}>
          <AlertCircle size={14} color={semantic.error} strokeWidth={1.5} aria-hidden="true" />
          <Typography style={{ color: semantic.error, fontSize: '0.8125rem' }}>{error}</Typography>
        </Box>
      )}

      <button
        type="submit"
        disabled={loading}
        aria-busy={loading}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: '10px 20px', borderRadius: 6, cursor: loading ? 'not-allowed' : 'pointer',
          background: loading ? semantic.successBgHover : semantic.successBg,
          border: `1px solid ${semantic.success}`,
          color: semantic.success, fontSize: '0.875rem', fontWeight: 600,
        }}
      >
        {loading
          ? <Loader size={14} strokeWidth={1.5} aria-hidden="true" />
          : <CheckCircle size={14} strokeWidth={2} aria-hidden="true" />}
        {loading ? 'Registering...' : 'Complete registration'}
      </button>
    </Box>
  );
};

// ── Step Card ─────────────────────────────────────────────────────────────────

interface Step {
  id: string; number: number; title: string; description: string;
  done: boolean; autoDetected: boolean;
  actionLabel?: string; actionHref?: string; onAction?: () => void;
  custom?: React.ReactNode;
}

const StepCard = ({ step, isLast }: StepCardProps) => {
  const c = useColors();
  const isDone = step.done;


  return (
    <Box
      component="section"
      aria-label={step.title}
      data-done={isDone}
      display="flex"
      style={{ gap: 16, paddingBottom: isLast ? 0 : 24 }}
    >
      <Box display="flex" flexDirection="column" alignItems="center" style={{ width: 32, flexShrink: 0 }} aria-hidden="true">
        <Box display="flex" alignItems="center" justifyContent="center" style={{
          width: 32, height: 32, borderRadius: '50%',
          background: isDone ? semantic.successBg : c.avatarBg,
          border: `2px solid ${isDone ? semantic.success : c.border}`,
          flexShrink: 0,
        }}>
          {isDone
            ? <CheckCircle size={16} color={semantic.success} strokeWidth={2} />
            : <Circle size={16} color={c.textMuted} strokeWidth={2} />}
        </Box>
        {!isLast && <Box style={{ width: 2, flex: 1, minHeight: 24, background: isDone ? `${semantic.success}33` : c.border, marginTop: 4 }} />}
      </Box>

      <Box flex={1} style={{ paddingTop: 4, paddingBottom: isLast ? 0 : 8 }}>
        <Box display="flex" alignItems="center" style={{ gap: 8, marginBottom: 4 }}>
          <Typography style={{ fontSize: '0.9375rem', fontWeight: 600, color: isDone ? c.textSecondary : c.text }}>
            {step.title}
          </Typography>
          {isDone && <span style={badge('green')} aria-label="Completed">Done</span>}
          {!isDone && step.autoDetected && <span style={badge('amber')} aria-label="Pending action">Pending</span>}
        </Box>
        <Typography style={{ fontSize: '0.8125rem', color: c.textSecondary, lineHeight: 1.5, marginBottom: step.custom || step.actionLabel ? 12 : 0 }}>
          {step.description}
        </Typography>
        {step.custom}
        {!isDone && !step.custom && step.actionLabel && (
          <Box display="flex" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            {step.actionHref && (
              <a href={step.actionHref} target="_blank" rel="noopener noreferrer" style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', borderRadius: 6,
                background: c.surface, border: `1px solid ${c.border}`,
                color: c.text, fontSize: '0.8125rem', fontWeight: 500, textDecoration: 'none',
              }}>
                <ExternalLink size={13} strokeWidth={1.5} aria-hidden="true" />{step.actionLabel}
              </a>
            )}
            {step.onAction && !step.autoDetected && (
              <button
                onClick={step.onAction}
                aria-label={`Mark "${step.title}" as done`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '6px 14px', borderRadius: 6,
                  background: 'transparent', border: `1px solid ${c.border}`,
                  color: c.textSecondary, fontSize: '0.8125rem', fontWeight: 500, cursor: 'pointer',
                }}
              >
                <CheckCircle size={13} strokeWidth={1.5} aria-hidden="true" />Mark as done
              </button>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
};

// ── Main Page ─────────────────────────────────────────────────────────────────

export const OnboardingPage = () => {
  const identity = useIdentity();
  const config = useApi(configApiRef);
  const githubOwner = config.getOptionalString('organization.githubOwner') ?? '';
  const c = useColors();
  const userManagementApi = useApi(userManagementApiRef);
  const { done, mark, loadFromDb, isRegistered, markRegistered, clearRegistered } = useProgress(identity.userRef, userManagementApi);
  const { status: ghStatus, login: ghLogin, refresh: refreshGitHub, isTeamAssigned } = useGitHubStatus(identity.userRef, loadFromDb);

  // Records when the user submitted the form in the current session.
  // Used to distinguish a freshly-set localStorage flag (do not clear) from a stale one (do clear).
  const submittedAt = useRef<number | null>(null);

  const handleRegistered = useCallback(() => {
    submittedAt.current = Date.now();
    markRegistered();
  }, [markRegistered]);

  // Clear a stale "registered" flag if DB confirms the user has no team.
  // Only clear if the flag is older than 45s (longer than one poll cycle) — this prevents
  // clearing a flag that was just set by the current session's form submit.
  useEffect(() => {
    if (isTeamAssigned === false && isRegistered) {
      const age = submittedAt.current !== null ? Date.now() - submittedAt.current : Infinity;
      if (age > 45_000) clearRegistered();
    }
  }, [isTeamAssigned, isRegistered, clearRegistered]);

  const card = {
    background: c.surface,
    border: `1px solid ${c.border}`,
    borderRadius: 8,
    padding: '20px 24px',
  } as const;

  if (identity.loading) {
    return (
      <Page themeId="tool">
        <Header title="Onboarding" />
        <Content>
          <Box display="flex" justifyContent="center" mt={6}>
            <CircularProgress aria-label="Loading onboarding" />
          </Box>
        </Content>
      </Page>
    );
  }

  // The user_management DB is the single source of truth for registration.
  // Admins bypass the check (they don't need to self-register).
  // Catalog team membership (isNewUser) is intentionally NOT used — users can be in the
  // catalog with teams but have teams=[] in the DB (created via GitHub link before registering).
  const isDbRegistered = isTeamAssigned === true || identity.isAdmin;
  const isFullyRegistered = isRegistered || isDbRegistered;
  // Show form when: not admin AND DB confirms no team (not in DB, or in DB without teams).
  const needsRegistration = !identity.isAdmin && isTeamAssigned === false && !isRegistered;

  const githubDone = ghStatus === 'verified';
  // Show spinner while DB check is in flight (for non-admins without a session flag).
  const registrationChecking = !identity.isAdmin && isTeamAssigned === undefined && !isRegistered;

  let registerDescription: string;
  if (needsRegistration) {
    registerDescription = 'Select your department team. This creates your profile in the portal.';
  } else if (isRegistered) {
    registerDescription = 'Registration submitted. Your profile will appear in the catalog within a minute.';
  } else {
    registerDescription = 'Your profile is registered in the portal.';
  }

  let registerCustom: JSX.Element | undefined;
  if (registrationChecking) {
    registerCustom = (
      <Box display="flex" alignItems="center" style={{ gap: 8, marginTop: 10 }}>
        <CircularProgress size={14} aria-hidden="true" />
        <Typography style={{ fontSize: '0.8125rem', color: c.textSecondary }}>
          Checking registration status…
        </Typography>
      </Box>
    );
  } else if (needsRegistration) {
    registerCustom = <RegistrationForm identity={identity} onRegistered={handleRegistered} />;
  }

  const steps: Step[] = [
    {
      id: 'register',
      number: 1,
      title: 'Complete your registration',
      description: registerDescription,
      done: isFullyRegistered,
      autoDetected: true,
      custom: registerCustom,
    },
    {
      id: 'github',
      number: 2,
      title: 'GitHub account',
      description: githubDone
        ? `GitHub account linked: @${ghLogin ?? 'connected'}. Project creation will use this account in ${githubOwner}.`
        : `Connect your GitHub account so the portal can create repos under ${githubOwner} on your behalf.`,
      done: githubDone,
      autoDetected: true,
      custom: githubDone ? undefined : <GitHubConnectButton onConnected={refreshGitHub} />,
    },
    {
      id: 'catalog-tour',
      number: 3,
      title: 'Catalog tour',
      description: "Explore the catalog to find your team's services, APIs, and components.",
      done: done['catalog-tour'] ?? false,
      autoDetected: false,
      actionLabel: 'Open Catalog',
      actionHref: '/catalog',
      onAction: () => mark('catalog-tour', !(done['catalog-tour'] ?? false)),
    },
    {
      id: 'engineering-docs',
      number: 4,
      title: 'Engineering docs',
      description: 'Read the engineering standards and guidelines — golden paths, best practices, how we build.',
      done: done['engineering-docs'] ?? false,
      autoDetected: false,
      actionLabel: 'Open Docs',
      actionHref: '/engineering-docs',
      onAction: () => mark('engineering-docs', !(done['engineering-docs'] ?? false)),
    },
  ];

  const completedCount = steps.filter(s => s.done).length;
  const allDone = completedCount === steps.length;
  const pct = Math.round((completedCount / steps.length) * 100);
  const firstName = identity.displayName.split(' ')[0];

  return (
    <Page themeId="tool">
      <Header
        title="Onboarding"
        subtitle={allDone ? "You're all set!" : `${completedCount} of ${steps.length} steps complete`}
      />
      <Content>
        <Box style={{ maxWidth: 720, margin: '0 auto' }}>

          {/* Welcome card */}
          <Box component="section" aria-label="Welcome" style={{ ...card, marginBottom: 24 }}>
            <Box display="flex" alignItems="center" style={{ gap: 12, marginBottom: 12 }}>
              <Box
                aria-hidden="true"
                style={{
                  width: 40, height: 40, borderRadius: '50%',
                  background: identity.picture ? 'transparent' : c.avatarBg,
                  border: `2px solid ${c.border}`, overflow: 'hidden', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {identity.picture
                  ? <img src={identity.picture} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <User size={20} color={c.textSecondary} strokeWidth={1.5} />}
              </Box>
              <Box>
                <Typography style={{ fontSize: '1.125rem', fontWeight: 600, color: c.text, lineHeight: 1.2 }}>
                  {allDone ? `You're all set, ${firstName}!` : `Welcome, ${firstName}!`}
                </Typography>
                <Typography style={{ fontSize: '0.8125rem', color: c.textSecondary }}>
                  {identity.email}
                </Typography>
              </Box>
            </Box>
            <Box display="flex" alignItems="center" style={{ gap: 12 }}>
              <Box flex={1}>
                <LinearProgress
                  variant="determinate"
                  value={pct}
                  aria-label={`${completedCount} of ${steps.length} steps complete`}
                  style={{ height: 6, borderRadius: 3, backgroundColor: c.progressTrack }}
                />
              </Box>
              <Typography style={{ fontSize: '0.75rem', color: c.textSecondary, whiteSpace: 'nowrap' }} aria-hidden="true">
                {completedCount}/{steps.length}
              </Typography>
            </Box>
          </Box>

          {/* Unassigned banner */}
          {needsRegistration && (
            <Box
              role="alert"
              display="flex"
              alignItems="flex-start"
              style={{
                ...card, marginBottom: 24,
                background: semantic.warningBg,
                border: `1px solid ${semantic.warningBorder}`,
                gap: 12,
              }}
            >
              <AlertCircle size={18} color={semantic.warning} strokeWidth={1.5} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
              <Box>
                <Typography style={{ fontSize: '0.875rem', fontWeight: 600, color: semantic.warning, marginBottom: 2 }}>
                  Action required — complete your registration
                </Typography>
                <Typography style={{ fontSize: '0.8125rem', color: semantic.warningText }}>
                  You're not yet assigned to a team. Complete Step 1 below to join your department.
                  Until then you have access to Engineering Docs, Tech Radar, and this page.
                </Typography>
              </Box>
            </Box>
          )}

          {/* Steps */}
          <Box component="section" aria-label="Onboarding steps" style={card}>
            {steps.map((step, idx) => (
              <StepCard key={step.id} step={step} isLast={idx === steps.length - 1} />
            ))}
          </Box>

          {/* All done */}
          {allDone && (
            <Box
              component="section"
              aria-label="Onboarding complete"
              style={{ ...card, marginTop: 24, textAlign: 'center', padding: '32px 24px' }}
            >
              <CheckCircle size={40} color={semantic.success} strokeWidth={1.5} style={{ margin: '0 auto 12px' }} aria-hidden="true" />
              <Typography style={{ fontSize: '1rem', fontWeight: 600, color: c.text, marginBottom: 6 }}>
                Onboarding complete!
              </Typography>
              <Typography style={{ fontSize: '0.8125rem', color: c.textSecondary }}>
                You're ready. Explore the catalog, create projects, check engineering docs.
              </Typography>
            </Box>
          )}

          {/* Quick links */}
          <nav aria-label="Quick links" style={{ marginTop: 24 }}>
            <Typography style={{ fontSize: '0.6875rem', fontWeight: 600, color: c.textMuted, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 12 }} aria-hidden="true">
              Quick links
            </Typography>
            <Box display="flex" style={{ gap: 8, flexWrap: 'wrap' }}>
              {[
                { icon: LayoutGrid, label: 'Catalog', href: '/catalog' },
                { icon: BookOpen, label: 'Engineering Docs', href: '/engineering-docs' },
                { icon: GitBranch, label: 'GitHub', href: `https://github.com/${githubOwner}`, external: true },
              ].map(({ icon: Icon, label, href, external }) => (
                <a
                  key={label}
                  href={href}
                  target={external ? '_blank' : undefined}
                  rel={external ? 'noopener noreferrer' : undefined}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '8px 14px', borderRadius: 6,
                    background: c.surface, border: `1px solid ${c.border}`,
                    color: c.textSecondary, fontSize: '0.8125rem', fontWeight: 500, textDecoration: 'none',
                  }}
                >
                  <Icon size={14} strokeWidth={1.5} aria-hidden="true" />{label}
                </a>
              ))}
            </Box>
          </nav>
        </Box>
      </Content>
    </Page>
  );
};
