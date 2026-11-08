import { Knex } from 'knex';
import { randomUUID } from 'crypto';

export type EnrollmentStatus = 'seeded' | 'active' | 'completed' | 'withdrawn';

/** What any instructor list shows. Never includes the instructor-only seed outputs. */
export interface EnrollmentSummary {
  id: string;
  capstone: string;
  traineeEmail: string;
  traineeNo: string;
  status: EnrollmentStatus;
  repoUrl?: string;
  handoutPrUrl?: string;
  handoutAt?: string;
  /** Laptop-seeded capstones: when the laptop reported its seed (data is unverified). */
  seedReportedAt?: string;
  /** Laptop-seeded capstones still waiting for the laptop's seed report. */
  awaitingSeedReport: boolean;
  createdAt: string;
  /** Set when an instructor marked the capstone done (status 'completed'). */
  completedAt?: string;
  completedBy?: string;
  /** A report snapshot was kept at completion (the report itself is read with getReport). */
  hasReport: boolean;
}

export interface EnrollmentSecrets {
  seedManifest: unknown;
  credentials: string;
  answerKey: string;
}

/** What the seed step hands to `enroll`: server-seeded secrets, or a laptop seed-report token. */
export interface EnrollSeed {
  seedManifest?: unknown;
  credentials?: string;
  answerKey?: string;
  /** sha256 hex of the single-use seed-report token (laptop seeds). */
  seedTokenHash?: string;
  seedTokenExpiresAt?: Date;
}

export interface SeedReport {
  seedManifest: unknown;
  credentials: string;
  answerKey: string;
  handover: string;
}

/** A seeded enrollment with no repo after this long is abandoned (the scaffolder run failed). */
export const ABANDON_AFTER_MS = 60 * 60_000;
const TABLE = 'capstone_enrollments';

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : undefined);
const toSummary = (r: any): EnrollmentSummary => ({
  id: r.id,
  capstone: r.capstone,
  traineeEmail: r.trainee_email,
  traineeNo: r.trainee_no,
  status: r.status,
  repoUrl: r.repo_url ?? undefined,
  handoutPrUrl: r.handout_pr_url ?? undefined,
  handoutAt: iso(r.handout_at),
  seedReportedAt: iso(r.seed_reported_at),
  awaitingSeedReport: Boolean(r.seed_token_hash),
  createdAt: iso(r.created_at)!,
  completedAt: iso(r.completed_at),
  completedBy: r.completed_by ?? undefined,
  hasReport: Boolean(r.has_report),
});

const SUMMARY_COLUMNS = [
  'id', 'capstone', 'trainee_email', 'trainee_no', 'status', 'repo_url',
  'handout_pr_url', 'handout_at', 'seed_reported_at', 'seed_token_hash', 'created_at', 'completed_at', 'completed_by',
];

/** Largest report snapshot kept (the report of one lab is a few kilobytes). */
export const MAX_REPORT_BYTES = 512 * 1024;

/** `prefer` when it is free (a trainee starting over keeps their number), else the lowest free 01–99. */
export function nextTraineeNo(held: string[], prefer?: string): string | undefined {
  const used = new Set(held);
  if (prefer && /^\d{2}$/.test(prefer) && prefer !== '00' && !used.has(prefer)) return prefer;
  for (let n = 1; n <= 99; n++) {
    const no = String(n).padStart(2, '0');
    if (!used.has(no)) return no;
  }
  return undefined;
}

export class CapstoneStore {
  constructor(private readonly db: Knex, private readonly now: () => Date = () => new Date()) {}

  /**
   * Reserve a trainee number and run `seed(no)` for it, storing the result — all inside one
   * transaction so a double-submit can't hand out the same number twice. The seed's secrets go
   * straight into the row; only the trainee files are returned to the caller.
   */
  async enroll<T extends EnrollSeed>(
    capstone: string,
    traineeEmail: string,
    seed: (traineeNo: string) => Promise<T>,
    options: { preferTraineeNo?: string } = {},
  ): Promise<{ enrollment: EnrollmentSummary; seeded: T }> {
    return this.db.transaction(async trx => {
      // Serialise reservations per capstone (Postgres advisory lock; a no-op elsewhere).
      if (trx.client.config?.client === 'pg') {
        await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`capstone:${capstone}`]);
      }
      // ISO string, not a Date: SQLite stores timestamps as text and compares a bound Date as a
      // number (so nothing would ever count as abandoned); Postgres casts the string fine.
      const cutoff = new Date(this.now().getTime() - ABANDON_AFTER_MS).toISOString();
      const held = await trx(TABLE)
        .where({ capstone })
        .andWhere(q => q.whereIn('status', ['active', 'completed']).orWhere(q2 => q2.where('status', 'seeded').andWhere('created_at', '>', cutoff)))
        .pluck('trainee_no');
      const traineeNo = nextTraineeNo(held, options.preferTraineeNo);
      if (!traineeNo) throw new Error(`All 99 trainee numbers for capstone "${capstone}" are in use`);

      const seeded = await seed(traineeNo);
      const id = randomUUID();
      const nowIso = this.now().toISOString();
      await trx(TABLE).insert({
        id,
        capstone,
        trainee_email: traineeEmail,
        trainee_no: traineeNo,
        status: 'seeded',
        seed_manifest: seeded.seedManifest === undefined ? null : JSON.stringify(seeded.seedManifest),
        credentials: seeded.credentials ?? null,
        answer_key: seeded.answerKey ?? null,
        seed_token_hash: seeded.seedTokenHash ?? null,
        seed_token_expires_at: seeded.seedTokenExpiresAt?.toISOString() ?? null,
        created_at: nowIso,
        updated_at: nowIso,
      });
      return {
        enrollment: {
          id,
          capstone,
          traineeEmail,
          traineeNo,
          status: 'seeded' as const,
          awaitingSeedReport: Boolean(seeded.seedTokenHash),
          createdAt: nowIso,
          hasReport: false,
        },
        seeded,
      };
    });
  }

  /** Record the trainee repo once. Only the enrolled trainee, only while seeded. */
  async linkRepo(id: string, traineeEmail: string, repoUrl: string): Promise<EnrollmentSummary | undefined> {
    const updated = await this.db(TABLE)
      .where({ id, trainee_email: traineeEmail, status: 'seeded' })
      .update({ repo_url: repoUrl, status: 'active', updated_at: this.now().toISOString() });
    return updated ? this.get(id) : undefined;
  }

  /** True when another enrollment (not withdrawn) already has this repo. GitHub names are case-insensitive. */
  async repoLinkedElsewhere(repoUrl: string, exceptId: string): Promise<boolean> {
    const base = repoUrl.trim().toLowerCase().replace(/\/$/, '').replace(/\.git$/, '');
    const row = await this.db(TABLE)
      .select('id')
      .whereRaw('lower(repo_url) in (?, ?, ?)', [base, `${base}.git`, `${base}/`])
      .whereNot('status', 'withdrawn')
      .whereNot('id', exceptId)
      .first();
    return !!row;
  }

  /** The columns every list shows, plus whether a report snapshot exists (the snapshot itself is not read here). */
  private summaries() {
    return this.db(TABLE).select(SUMMARY_COLUMNS).select(this.db.raw('(report is not null) as has_report'));
  }

  /**
   * The instructor marks an active capstone done: stamps who and when and keeps the lab report as it stands now. Only an active
   * enrollment (its repository is recorded) can be completed, and only once.
   */
  async complete(id: string, completedBy: string, report: unknown): Promise<EnrollmentSummary | undefined> {
    const json = JSON.stringify(report);
    if (Buffer.byteLength(json) > MAX_REPORT_BYTES) throw new Error(`The report is larger than ${MAX_REPORT_BYTES / 1024} KB`);
    const nowIso = this.now().toISOString();
    const updated = await this.db(TABLE)
      .where({ id, status: 'active' })
      .update({ status: 'completed', completed_at: nowIso, completed_by: completedBy, report: json, updated_at: nowIso });
    return updated ? this.get(id) : undefined;
  }

  /** Undo a completion that was a mistake: back to active, the snapshot is discarded. */
  async reopen(id: string): Promise<EnrollmentSummary | undefined> {
    const updated = await this.db(TABLE)
      .where({ id, status: 'completed' })
      .update({ status: 'active', completed_at: null, completed_by: null, report: null, updated_at: this.now().toISOString() });
    return updated ? this.get(id) : undefined;
  }

  /** The report kept at completion. */
  async getReport(id: string): Promise<{ report: unknown; completedAt?: string; completedBy?: string } | undefined> {
    const row = await this.db(TABLE).select('report', 'completed_at', 'completed_by').where({ id, status: 'completed' }).first();
    if (!row?.report) return undefined;
    return { report: JSON.parse(row.report), completedAt: iso(row.completed_at), completedBy: row.completed_by ?? undefined };
  }

  async list(): Promise<EnrollmentSummary[]> {
    const rows = await this.summaries()
      .whereNot('status', 'withdrawn')
      .orderBy('created_at', 'desc');
    return rows.map(toSummary);
  }

  /** The trainee's own current (not withdrawn) enrollments in one capstone. */
  async listForTrainee(capstone: string, traineeEmail: string): Promise<EnrollmentSummary[]> {
    const rows = await this.summaries()
      .where({ capstone, trainee_email: traineeEmail })
      .whereNot('status', 'withdrawn')
      .orderBy('created_at', 'desc');
    return rows.map(toSummary);
  }

  async get(id: string): Promise<EnrollmentSummary | undefined> {
    const row = await this.summaries().where({ id }).first();
    return row ? toSummary(row) : undefined;
  }

  async getSecrets(id: string): Promise<EnrollmentSecrets | undefined> {
    const row = await this.db(TABLE).select('seed_manifest', 'credentials', 'answer_key').where({ id }).first();
    if (!row || row.credentials === null || row.credentials === undefined) return undefined; // laptop seed not reported yet
    const manifest = typeof row.seed_manifest === 'string' ? JSON.parse(row.seed_manifest) : row.seed_manifest;
    return { seedManifest: manifest, credentials: row.credentials, answerKey: row.answer_key };
  }

  /**
   * Accept a laptop seed report. Single use and atomic: the row only updates when the token hash
   * matches and hasn't expired, and the update clears the hash, so a replay or a concurrent second
   * report changes nothing. Returns false for an unknown id, a wrong/used/expired token alike.
   */
  async acceptSeedReport(id: string, tokenHash: string, report: SeedReport): Promise<boolean> {
    const nowIso = this.now().toISOString();
    const updated = await this.db(TABLE)
      .where({ id, seed_token_hash: tokenHash })
      .andWhere('seed_token_expires_at', '>', nowIso)
      .update({
        seed_manifest: JSON.stringify(report.seedManifest),
        credentials: report.credentials,
        answer_key: report.answerKey,
        handover: report.handover,
        seed_token_hash: null,
        seed_token_expires_at: null,
        seed_reported_at: nowIso,
        updated_at: nowIso,
      });
    return updated === 1;
  }

  /** Trainee-facing handover waiting to be committed to the trainee repo (laptop seeds). */
  async pendingHandover(id: string): Promise<{ handover: string; repoUrl: string } | undefined> {
    const row = await this.db(TABLE).select('handover', 'repo_url', 'handover_committed_at').where({ id }).first();
    if (!row?.handover || !row.repo_url || row.handover_committed_at) return undefined;
    return { handover: row.handover, repoUrl: row.repo_url };
  }

  async markHandoverCommitted(id: string): Promise<void> {
    const nowIso = this.now().toISOString();
    await this.db(TABLE).where({ id }).update({ handover_committed_at: nowIso, updated_at: nowIso });
  }

  /**
   * Remove an enrollment from the instructor list (a failed scaffolder run, a trainee who left).
   * Frees its trainee number and cancels a pending seed-report token, and discards the report an instructor kept when it was marked
   * done (deleting an archived capstone removes its report); the row itself stays for the record.
   */
  async withdraw(id: string): Promise<EnrollmentSummary | undefined> {
    const updated = await this.db(TABLE)
      .where({ id })
      .whereNot('status', 'withdrawn')
      .update({ status: 'withdrawn', seed_token_hash: null, seed_token_expires_at: null, report: null, updated_at: this.now().toISOString() });
    return updated ? this.get(id) : undefined;
  }

  async recordHandout(id: string, prUrl: string): Promise<void> {
    const nowIso = this.now().toISOString();
    await this.db(TABLE).where({ id }).update({ handout_pr_url: prUrl, handout_at: nowIso, updated_at: nowIso });
  }
}
