/**
 * The capstones the portal can seed per trainee: Part 2 "B" (brownfield: take over something broken) and Part 1 "A"
 * (greenfield: build from a client spec). Every id ends in -a or -b.
 *
 * Brownfield capstones:  Each lives in a private training repo
 * (instructor guide, seed, grader, Day-4 handout); the portal calls its scripts and never copies
 * the fault list (it lives in the capstone repo and changes there).
 */
/** Context a job builder gets; `sourceFiles` are fetched server-side from the capstone repo. */
export interface CheckContext {
  manifest: any;
  credentials: string;
  traineeNo: string;
  repoUrl: string;
  sourceFiles: Record<string, string>; // repo path → base64
}

/** An instructor check: a command inside a lab container, or a one-off job next to the lab. */
export type CapstoneCheck = {
  title: string;
} & (
  | { service: string; argv: (manifest: any, traineeNo: string) => string[] }
  | { needsSourceFiles: string[]; job: (ctx: CheckContext) => Record<string, unknown> }
);

export interface CapstoneDefinition {
  id: string;
  title: string;
  /**
   * `server`: the seed only writes files, so the portal runs it (Node.js). `laptop`: the seed must
   * run against the trainee's local environment (Terraform → their MiniStack), so it runs in a
   * one-shot container on the laptop and reports back with a single-use token.
   */
  seedMode: 'server' | 'laptop';
  /** Files the laptop seed container needs (repo-root relative), delivered with the lab. */
  laptopSeedFiles?: string[];
  /** The lab runs a self-hosted GitHub Actions runner (Terraform: CI must reach the local MiniStack). */
  selfHostedRunner?: boolean;
  /** owner/repo of the private capstone source. */
  sourceRepo: string;
  branch: string;
  /** Folder copied into every trainee repo. */
  templateDir: string;
  /**
   * Repo-root files also given to trainees (the instructor guide hands them the spec as a link,
   * but the capstone repo is private). Never instructor/ content.
   */
  traineeDocs: string[];
  /** Seed script (relative to the repo root) and its arguments. */
  seedScript: string;
  seedArgs: (appDir: string, outDir: string, traineeNo: string) => string[];
  /** Files the seed writes into outDir: kept instructor-only, never sent to the trainee. */
  seedOutputs: { manifest: string; credentials: string; answerKey: string };
  /** Day-4 sabotaged handout (instructor guide §2.3): a file or a directory pushed to a branch, optionally with a PR. */
  handout: {
    /** A file, or a directory whose files are all copied. */
    sourcePath: string;
    /** Target file, or target directory when sourcePath is a directory. */
    targetPath: string;
    branch: string;
    commitMessage: string;
    /** Omit for capstones whose guide pushes only a branch (Terraform). */
    prTitle?: string;
    prBody?: string;
    /** What instructors see on the Trainees page (default: the brownfield Day-4 sabotaged PR). */
    label?: string;
    instructions?: string;
  };
  /** Shown to instructors: how to grade (the grader must not run inside the portal backend). */
  gradeCommand: string;
  /**
   * Instructor checks run inside the trainee's lab via the agent (`run-check`, agent ≥ 0.1.23).
   * `argv` is built from the instructor-only manifest; it runs inside one lab container only.
   */
  checks?: Record<string, CapstoneCheck>;
}

/**
 * Terraform hard fail #1: "any seeded prod resource destroyed or replaced before Stage 7". Runs
 * inside the trainee's MiniStack container (python3 + boto3 are in the image) against its own API
 * with the prod account key; a replaced resource has a new id, so the seeded id is "missing".
 * Prints JSON {checked, missing}; exit 1 when anything is missing.
 */
/**
 * The Terraform grader job (instructor guide §2.5). Runs in hashicorp/terraform (git + grep +
 * terraform) on the lab network so the manifest's endpoint `http://ministack:4566` resolves. The
 * capstone's grade.py never runs `terraform init`, so on a fresh clone its plan check always fails;
 * we init first, best-effort. The JSON result is printed last and written to /job/out.json.
 */
export const TERRAFORM_GRADE_JOB_SCRIPT = `set -u
# GNU grep: grade.py uses \`grep --include=…\`, which the image's BusyBox grep doesn't support.
apk add --no-cache -q python3 py3-boto3 grep >/dev/null 2>&1 || { echo "could not install python3/boto3/grep"; exit 3; }
cd /job
if [ -f repo/envs/prod/.terraform.lock.hcl ]; then
  (cd repo/envs/prod && terraform init -input=false -no-color > /job/init.log 2>&1) || echo "terraform init failed: the plan will count as not clean (see init.log)"
fi
python3 /job/grade.py --manifest /job/manifest.json --credentials /job/credentials.txt --repo /job/repo --phase "$PHASE" --json /job/out.json > /job/grade.txt 2>&1
tail -40 /job/grade.txt
[ -f /job/out.json ] || exit 4
exit 0
`;

export const TERRAFORM_SEEDED_RESOURCES_CHECK = String.raw`
import json, sys, boto3
from botocore.config import Config
a = json.loads(sys.argv[1]); res = a["resources"]
kw = dict(endpoint_url="http://localhost:4566", region_name="ap-southeast-1",
          aws_access_key_id=a["key"], aws_secret_access_key="test", config=Config(retries={"max_attempts": 1}))
c = lambda s: boto3.client(s, **kw)
def alive(key, ident):
    p = key.split(".")[0]
    if key == "vpc": return bool(c("ec2").describe_vpcs(VpcIds=[ident])["Vpcs"])
    if p == "ec2": return any(i["State"]["Name"] != "terminated" for r in c("ec2").describe_instances(InstanceIds=[ident])["Reservations"] for i in r["Instances"])
    if p == "sg": return bool(c("ec2").describe_security_groups(GroupIds=[ident])["SecurityGroups"])
    if key == "rds.instance": return bool(c("rds").describe_db_instances(DBInstanceIdentifier=ident)["DBInstances"])
    if key == "lambda.order-api": return bool(c("lambda").get_function(FunctionName=ident))
    if p == "s3": c("s3").head_bucket(Bucket=ident); return True
    if p == "sns": return bool(c("sns").get_topic_attributes(TopicArn=ident))
    if key == "r53.zone": return bool(c("route53").get_hosted_zone(Id=ident))
    return None  # not checked
checked, missing = 0, []
for key, r in sorted(res.items()):
    try: ok = alive(key, r["id"])
    except Exception: ok = False
    if ok is None: continue
    checked += 1
    if not ok: missing.append(key)
print(json.dumps({"checked": checked, "missing": missing}))
sys.exit(1 if missing else 0)
`;

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

/** The Node.js lab's image: Node 24 (the course stack; the grader needs node:sqlite) + git + the
 * build tools better-sqlite3 compiles with. Multi-arch (Apple Silicon included). */
export const NODE_LAB_IMAGE = 'node:24.21.0-bookworm';

/**
 * The Node.js grader job (instructor guide §2.4): the course's own grade.mjs in a throwaway
 * Node 24 container on the trainee's machine — static checks on the submission, then (when there is
 * no hard fail) the live part: npm ci, start the app on a copy of data/kalye.db, probe it. The
 * grader exits 1 on a hard fail, which is a valid grade, so success = a result file was written.
 */
export const NODE_GRADE_JOB_SCRIPT = `set -u
cd /job
node /job/grade.mjs --manifest /job/manifest.json --credentials /job/credentials.txt --repo /job/repo --json /job/out.json > /job/grade.txt 2>&1
tail -45 /job/grade.txt
[ -f /job/out.json ] || exit 4
exit 0
`;

/**
 * Capstone A's grader job: grade.mjs builds and starts the trainee's API on a throwaway database in
 * the lab's own PostgreSQL (the job joins the lab network, so it answers as `db`), runs the hidden
 * acceptance tests over HTTP and drops the database. It needs only `pg`, installed into the job
 * folder. Exit 0 whenever a result was written (a hard fail is still a grade).
 */
export const NODE_A_GRADE_JOB_SCRIPT = `set -u
cd /job
npm install --prefix /job/tools --no-audit --no-fund --silent pg@8.23.1 > /job/tools.log 2>&1 || { echo "could not install the grader's PostgreSQL client (see tools.log)"; exit 3; }
node /job/grade.mjs --repo /job/repo --admin-db-url "$GRADER_ADMIN_DB_URL" --pg-module /job/tools/node_modules/pg --json /job/out.json > /job/grade.txt 2>&1
tail -60 /job/grade.txt
[ -f /job/out.json ] || exit 4
exit 0
`;

/**
 * The Capstone A lab's PostgreSQL superuser, as its compose file defines it
 * (engineering-standards nodejs-capstone-a-training-local). A lab-local database bound to
 * 127.0.0.1 on the trainee's laptop, not an instructor secret.
 */
export const NODE_A_LAB_DB_ADMIN_URL = 'postgresql://biyahe:biyahe@db:5432/postgres';

/**
 * Terraform Capstone A's grader job: grade.py deploys the trainee's `capstone-final` tag into three
 * FRESH accounts on the lab's MiniStack (never the trainee's own), probes them with boto3, plans a
 * partner insertion/removal, tears down, and writes out.json. Runs in hashicorp/terraform (alpine:
 * git is in the image, python3 + boto3 + PyYAML come from apk). Exit 0 whenever a result was written
 * (a hard fail is still a grade).
 */
export const TERRAFORM_A_GRADE_JOB_SCRIPT = `set -u
apk add --no-cache -q python3 py3-boto3 py3-yaml >/dev/null 2>&1 || { echo "could not install python3, boto3 and PyYAML"; exit 3; }
git config --global --add safe.directory '*'
cd /job
python3 /job/grade.py --repo /job/repo --json /job/out.json --trainee "$TRAINEE_NO" > /job/grade.txt 2>&1
tail -70 /job/grade.txt
[ -f /job/out.json ] || exit 4
exit 0
`;

/**
 * The Linux grader job, run as root INSIDE the trainee's VM (the grader inspects the server
 * itself). grade.py looks for the seeded credentials at /root/seed-output/credentials.txt to check
 * they are no longer exposed, so the job puts them there for the run and removes them after.
 * `{{job}}` is replaced by the job folder inside the VM.
 */
export const LINUX_GRADE_JOB_SCRIPT = `set -u
J="$1"
mkdir -p /root/seed-output && cp "$J/credentials.txt" /root/seed-output/credentials.txt
python3 "$J/grade.py" --manifest "$J/manifest.json" --repo "$J/repo" --json "$J/out.json" > "$J/grade.txt" 2>&1
tail -40 "$J/grade.txt"
rm -rf /root/seed-output
[ -f "$J/out.json" ] || exit 4
exit 0
`;

/**
 * Linux Capstone A's grader job, run as root INSIDE the trainee's VM (the server is the deliverable).
 * grade.py adds test partners to a copy of the trainee's partners.json, runs the trainee's provision.sh,
 * behaves like partners (SFTP, rsync, escape attempts), runs the nightly check, a backup and a restore,
 * then re-provisions with the trainee's own partner list. `{{job}}` is the job folder in the VM.
 */
export const LINUX_A_GRADE_JOB_SCRIPT = `set -u
J="$1"
# One grading run at a time: a second Grade click (or a run the portal gave up on) must not overlap the first.
exec 9>/var/lock/padala-grade.lock
flock -n 9 || { echo "another grading run is still going on this server"; exit 5; }
command -v git >/dev/null 2>&1 || { apt-get update -qq >/dev/null 2>&1; apt-get install -y -qq git >/dev/null 2>&1; }
# The grader puts the server back when it is told to stop (TERM); KILL only after a grace period.
timeout --signal=TERM --kill-after=60 1620 python3 "$J/grade.py" --repo "$J/repo" --json "$J/out.json" > "$J/grade.txt" 2>&1
tail -80 "$J/grade.txt"
[ -f "$J/out.json" ] || exit 4
exit 0
`;

function terraformGradeJob(phase: 'pre' | 'post', title: string): CapstoneCheck {
  return {
    title,
    needsSourceFiles: ['instructor/seed/grade.py'],
    job: ctx => ({
      image: 'hashicorp/terraform:1.11.4',
      files: {
        'grade.py': ctx.sourceFiles['instructor/seed/grade.py'],
        'manifest.json': b64(JSON.stringify(ctx.manifest)),
        'credentials.txt': b64(ctx.credentials),
        'run.sh': b64(TERRAFORM_GRADE_JOB_SCRIPT),
      },
      clone: { url: ctx.repoUrl, ref: 'capstone-final' },
      networkOfService: 'ministack',
      command: ['sh', '/job/run.sh'],
      env: {
        PHASE: phase,
        AWS_ENDPOINT_URL: 'http://ministack:4566',
        AWS_ACCESS_KEY_ID: `0000000000${ctx.traineeNo}`,
        AWS_SECRET_ACCESS_KEY: 'test',
        AWS_REGION: 'ap-southeast-1',
        AWS_DEFAULT_REGION: 'ap-southeast-1',
      },
      outFile: 'out.json',
      timeoutMs: 15 * 60_000,
    }),
  };
}

/**
 * Python Capstone A's grader job: grade.py (and the files it imports: the shared data generator, the hidden mock source, the answer key,
 * the vendor B routes) runs in the same Python image as the trainee's `dev` container, on the lab network. It starts its OWN hidden
 * source inside the job (random seed, 127.0.0.1) and uses a throwaway database and a random bucket in the lab's PostgreSQL and object
 * store; the trainee's lab data is never touched. Exit 0 whenever a result was written (a hard fail is still a grade).
 */
export const PYTHON_LAB_IMAGE = 'python:3.12.12-bookworm';
export const PYTHON_A_GRADE_JOB_SCRIPT = `set -u
# The clone belongs to the laptop's user and git runs as root here: without this git refuses to read it.
git config --global --add safe.directory '*'
cd /job
# grade.py loads the answer key into memory, then removes it (and itself) from the job folder before it runs any trainee code.
export GRADER_ERASE=1
python3 /job/grade.py --repo /job/repo --json /job/out.json --db-admin-url "$DB_ADMIN_URL" --s3-endpoint "$S3_ENDPOINT" --trainee "$TRAINEE_NO" > /job/grade.txt 2>&1
tail -70 /job/grade.txt
[ -f /job/out.json ] || exit 4
exit 0
`;

/**
 * The Python Capstone A lab's PostgreSQL superuser and object store, as its compose file defines them
 * (engineering-standards python-capstone-a-training-local): lab-local, bound to 127.0.0.1 on the trainee's laptop, not instructor secrets.
 */
export const PYTHON_A_LAB_DB_ADMIN_URL = 'postgresql://suki:suki@postgres:5432/postgres';
export const PYTHON_A_LAB_S3_ENDPOINT = 'http://objectstore:4566';

export const CAPSTONES: Record<string, CapstoneDefinition> = {
  'linux-b': {
    id: 'linux-b',
    title: 'Linux Capstone B: Inherited Production Server Rescue',
    seedMode: 'laptop',
    laptopSeedFiles: ['instructor/seed/break_etl01.sh'],
    sourceRepo: 'strat-training/linux-training-capstone-b',
    branch: 'main',
    templateDir: 'trainee-template',
    traineeDocs: ['CAPSTONE.md'],
    seedScript: 'instructor/seed/break_etl01.sh',
    seedArgs: () => [], // runs inside the trainee's VM (Multipass), see the lab's seed-runner
    seedOutputs: { manifest: 'seed-manifest.json', credentials: 'credentials.txt', answerKey: 'handover-answer-key.md' },
    handout: {
      sourcePath: 'instructor/day4-handout/cleanup.sh',
      targetPath: 'contrib/cleanup.sh',
      branch: 'contrib/cleanup',
      commitMessage: 'contrib: disk hygiene script from the platform team (please review before adding to the timer)',
    },
    checks: {
      grade: {
        title: 'Grade (on the trainee server)',
        needsSourceFiles: ['instructor/seed/grade.py'],
        job: ctx => ({
          files: {
            'grade.py': ctx.sourceFiles['instructor/seed/grade.py'],
            'manifest.json': b64(JSON.stringify(ctx.manifest)),
            'credentials.txt': b64(ctx.credentials),
            'run.sh': b64(LINUX_GRADE_JOB_SCRIPT),
          },
          clone: { url: ctx.repoUrl, ref: 'capstone-final' },
          command: ['bash', '{{job}}/run.sh', '{{job}}'],
          outFile: 'out.json',
          timeoutMs: 15 * 60_000,
        }),
      },
    },
    gradeCommand: 'Use "Grade (on the trainee server)" — it runs grade.py as root inside the trainee VM.',
  },
  'nodejs-b': {
    id: 'nodejs-b',
    title: 'Node.js Capstone B: Inherited API Rescue',
    seedMode: 'server',
    sourceRepo: 'strat-training/nodejs-training-capstone-b',
    branch: 'main',
    templateDir: 'trainee-template',
    traineeDocs: ['CAPSTONE.md'],
    seedScript: 'instructor/seed/make_seed.mjs',
    seedArgs: (appDir, outDir, traineeNo) => ['--app', appDir, '--out', outDir, '--trainee', traineeNo],
    seedOutputs: {
      manifest: 'seed-manifest.json',
      credentials: 'credentials.txt',
      answerKey: 'handover-answer-key.md',
    },
    handout: {
      sourcePath: 'instructor/day4-handout/auth-cache.ts',
      targetPath: 'src/middleware/auth-cache.ts',
      branch: 'contrib/auth-cache',
      commitMessage: 'perf(auth): cache verified tokens on the hot path (platform team)',
      prTitle: 'perf(auth): token cache for GET /menu',
      prBody:
        "Drop-in replacement for middleware/auth.ts — cuts p95 on /menu by 40% in our tests. Please merge before Friday's promo. — Platform team",
    },
    checks: {
      grade: {
        title: 'Grade (in the trainee lab)',
        needsSourceFiles: ['instructor/seed/grade.mjs'],
        job: ctx => ({
          image: NODE_LAB_IMAGE,
          files: {
            'grade.mjs': ctx.sourceFiles['instructor/seed/grade.mjs'],
            'manifest.json': b64(JSON.stringify(ctx.manifest)),
            'credentials.txt': b64(ctx.credentials),
            'run.sh': b64(NODE_GRADE_JOB_SCRIPT),
          },
          clone: { url: ctx.repoUrl, ref: 'capstone-final' },
          command: ['bash', '/job/run.sh'],
          outFile: 'out.json',
          // The live part runs npm ci and the app's own test suite.
          timeoutMs: 20 * 60_000,
        }),
      },
    },
    gradeCommand:
      'Use "Grade (in the trainee lab)". By hand: node instructor/seed/grade.mjs --manifest <manifest.json> --credentials <credentials.txt> --repo <trainee-repo-clone> --json grade.json',
  },
  'terraform-b': {
    id: 'terraform-b',
    title: 'Terraform Capstone B: Brownfield-to-Platform Migration',
    seedMode: 'laptop',
    laptopSeedFiles: ['instructor/seed/seed_prod.py'],
    selfHostedRunner: true,
    sourceRepo: 'strat-training/terraform-training-capstone-b',
    branch: 'main',
    templateDir: 'trainee-template',
    traineeDocs: ['CAPSTONE.md'],
    seedScript: 'instructor/seed/seed_prod.py',
    seedArgs: (_appDir, outDir, traineeNo) => ['--endpoint', 'http://ministack:4566', '--trainee', traineeNo, '--out', outDir],
    seedOutputs: {
      manifest: 'seed-manifest.json',
      credentials: 'credentials.txt',
      answerKey: 'handover-answer-key.md',
    },
    handout: {
      sourcePath: 'instructor/day4-handout/vendor-cache',
      targetPath: 'modules/vendor-cache',
      branch: 'contrib/vendor-cache',
      commitMessage: 'modules: vendor-cache from the Platform team (please review before use)',
    },
    checks: {
      'seeded-resources': {
        title: 'Seeded prod resources intact (hard fail #1)',
        service: 'ministack',
        argv: (manifest, traineeNo) => [
          'python3',
          '-c',
          TERRAFORM_SEEDED_RESOURCES_CHECK,
          JSON.stringify({ key: `1110000000${traineeNo}`, resources: manifest?.resources ?? {} }),
        ],
      },
      'grade-pre': terraformGradeJob('pre', 'Grade (before teardown)'),
      'grade-post': terraformGradeJob('post', 'Grade (after teardown: orphans)'),
    },
    gradeCommand:
      'instructor/seed/grade.py --manifest <manifest.json> --repo <trainee-repo-clone> --credentials <credentials.txt> --json grade-pre.json   # run against the trainee MiniStack (their laptop) before teardown, then again with --phase post',
  },
  'nodejs-a': {
    id: 'nodejs-a',
    title: 'Node.js Capstone A: Biyahe Norte Online Ticketing',
    // Greenfield: nothing to seed. The script writes the instructor files (client answers as the key).
    seedMode: 'server',
    sourceRepo: 'strat-training/nodejs-training-capstone-a',
    branch: 'main',
    templateDir: 'trainee-template',
    // CAPSTONE.md is the instructor guide here (traps, planted issues): trainees get trainee-template/README.md.
    traineeDocs: [],
    seedScript: 'instructor/seed/make_seed.mjs',
    seedArgs: (appDir, outDir, traineeNo) => ['--app', appDir, '--out', outDir, '--trainee', traineeNo],
    seedOutputs: {
      manifest: 'seed-manifest.json',
      credentials: 'credentials.txt',
      answerKey: 'handover-answer-key.md',
    },
    // The Day-3 change request, as a PR from the client.
    handout: {
      sourcePath: 'instructor/day3-handout/change-request-holidays.md',
      targetPath: 'docs/requirements/change-request-holidays.md',
      branch: 'client/holiday-pricing',
      commitMessage: 'docs: change request from the client — holiday pricing',
      prTitle: 'Change request: holiday pricing',
      prBody:
        'From the Biyahe Norte office. The app vendor has agreed to the contract change described in the file and ships it before your demo. Merge this into your requirements, then plan it through EPAV like any other task.',
      label: 'Day-3 change request',
      instructions:
        "Opens the client's holiday-pricing change request as a pull request on the trainee's repository. Send it to every trainee at the same time (Day 3, 13:00). Running it again reuses the same branch and PR.",
    },
    checks: {
      grade: {
        title: 'Grade (in the trainee lab)',
        needsSourceFiles: ['instructor/grader/grade.mjs'],
        job: ctx => ({
          image: NODE_LAB_IMAGE,
          files: {
            'grade.mjs': ctx.sourceFiles['instructor/grader/grade.mjs'],
            'run.sh': b64(NODE_A_GRADE_JOB_SCRIPT),
          },
          clone: { url: ctx.repoUrl, ref: 'capstone-final' },
          networkOfService: 'db',
          command: ['bash', '/job/run.sh'],
          env: { GRADER_ADMIN_DB_URL: NODE_A_LAB_DB_ADMIN_URL },
          outFile: 'out.json',
          // npm ci + build + the live tests (≈ 3 min on a laptop).
          timeoutMs: 20 * 60_000,
        }),
      },
    },
    gradeCommand:
      'Use "Grade (in the trainee lab)". By hand: node instructor/grader/grade.mjs --repo <trainee-repo-clone> --admin-db-url postgresql://<superuser>@<host>:5432/postgres --json grade.json (needs `pg` installed next to it, or --pg-module).',
  },
  'terraform-a': {
    id: 'terraform-a',
    title: 'Terraform Capstone A: Botika Bayan Orders Platform',
    // Greenfield: nothing to seed. The script writes the instructor files (client answers as the key).
    seedMode: 'server',
    // The pipeline is part of the work: the lab runs the trainee repo's self-hosted Actions runner.
    selfHostedRunner: true,
    sourceRepo: 'strat-training/terraform-training-capstone-a',
    branch: 'main',
    templateDir: 'trainee-template',
    // CAPSTONE.md is the instructor guide here (planted issues, traps): trainees get trainee-template/README.md.
    traineeDocs: [],
    seedScript: 'instructor/seed/make_seed.mjs',
    seedArgs: (appDir, outDir, traineeNo) => ['--app', appDir, '--out', outDir, '--trainee', traineeNo],
    seedOutputs: {
      manifest: 'seed-manifest.json',
      credentials: 'credentials.txt',
      answerKey: 'handover-answer-key.md',
    },
    // The Day-3 change request, as a PR from the client.
    handout: {
      sourcePath: 'instructor/day3-handout/change-request-partners.md',
      targetPath: 'docs/requirements/change-request-partners.md',
      branch: 'client/partner-access',
      commitMessage: 'docs: change request from the client — partner access',
      prTitle: 'Change request: partner access',
      prBody:
        'From the Botika Bayan operations office. Read the request in the file, add it to your requirements and design it, then plan it through EPAV like any other task. Partners come from partners.json; adding or removing one must never touch another.',
      label: 'Day-3 change request',
      instructions:
        "Opens the client's partner-access change request as a pull request on the trainee's repository. Send it to every trainee at the same time (Day 3, 13:00). Running it again reuses the same branch and PR.",
    },
    checks: {
      grade: {
        title: 'Grade (in the trainee lab)',
        needsSourceFiles: ['instructor/grader/grade.py'],
        job: ctx => ({
          image: 'hashicorp/terraform:1.11.4',
          files: {
            'grade.py': ctx.sourceFiles['instructor/grader/grade.py'],
            'run.sh': b64(TERRAFORM_A_GRADE_JOB_SCRIPT),
          },
          clone: { url: ctx.repoUrl, ref: 'capstone-final' },
          // The lab network: the grader reaches the trainee's MiniStack as http://ministack:4566, and
          // deploys into account numbers it makes up itself (it never calls the emulator's global reset).
          networkOfService: 'ministack',
          command: ['sh', '/job/run.sh'],
          env: { AWS_ENDPOINT_URL: 'http://ministack:4566', TRAINEE_NO: ctx.traineeNo },
          outFile: 'out.json',
          // Three environments deployed, planned twice, torn down (≈ 6 minutes on a laptop).
          timeoutMs: 25 * 60_000,
        }),
      },
    },
    gradeCommand:
      'Use "Grade (in the trainee lab)". By hand: python3 instructor/grader/grade.py --repo <trainee-repo-clone> --endpoint http://localhost:4566 --trainee <NN> --json grade.json (Terraform 1.11 on PATH; pip install boto3 pyyaml).',
  },
  'linux-a': {
    id: 'linux-a',
    title: 'Linux Capstone A: Padala Partner Drop Server',
    // Greenfield: the VM starts blank and nothing is seeded. The script writes the instructor files.
    seedMode: 'server',
    sourceRepo: 'strat-training/linux-training-capstone-a',
    branch: 'main',
    templateDir: 'trainee-template',
    // CAPSTONE.md is the instructor guide here (planted issues, traps): trainees get trainee-template/README.md.
    traineeDocs: [],
    seedScript: 'instructor/seed/make_seed.mjs',
    seedArgs: (appDir, outDir, traineeNo) => ['--app', appDir, '--out', outDir, '--trainee', traineeNo],
    seedOutputs: {
      manifest: 'seed-manifest.json',
      credentials: 'credentials.txt',
      answerKey: 'handover-answer-key.md',
    },
    // The Day-3 change request, as a PR from the client.
    handout: {
      sourcePath: 'instructor/day3-handout/change-request-rsync.md',
      targetPath: 'docs/requirements/change-request-rsync.md',
      branch: 'client/rsync-partners',
      commitMessage: 'docs: change request from the client — rsync partners',
      prTitle: 'Change request: rsync partners',
      prBody:
        'From the Padala Express operations office. Read the request in the file, add it to your requirements and design it, then plan it through EPAV like any other task. SFTP partners must keep working, and adding or removing a partner must never disturb another.',
      label: 'Day-3 change request',
      instructions:
        "Opens the client's rsync-partner change request as a pull request on the trainee's repository. Send it to every trainee at the same time (Day 3, 13:00). Running it again reuses the same branch and PR.",
    },
    checks: {
      grade: {
        title: 'Grade (on the trainee server)',
        needsSourceFiles: ['instructor/grader/grade.py'],
        job: ctx => ({
          files: {
            'grade.py': ctx.sourceFiles['instructor/grader/grade.py'],
            'run.sh': b64(LINUX_A_GRADE_JOB_SCRIPT),
          },
          clone: { url: ctx.repoUrl, ref: 'capstone-final' },
          command: ['bash', '{{job}}/run.sh', '{{job}}'],
          outFile: 'out.json',
          // provision.sh on a fresh VM installs packages (a few minutes), and the grader runs it three times.
          timeoutMs: 28 * 60_000,
        }),
      },
    },
    gradeCommand:
      'Use "Grade (on the trainee server)": it runs grade.py as root inside the trainee VM (it adds and removes test partners, then restores the trainee\'s own list). By hand, as root on the server: python3 grade.py --repo <clone of the capstone-final tag> --json grade.json',
  },
  'python-a': {
    id: 'python-a',
    title: 'Python Capstone A: Suki Supply Nightly Sales Report',
    // Greenfield: nothing to seed. The script writes the instructor files (client answers as the key).
    seedMode: 'server',
    sourceRepo: 'strat-training/python-training-capstone-a',
    branch: 'main',
    templateDir: 'trainee-template',
    // CAPSTONE.md is the instructor guide here (planted issues, traps): trainees get trainee-template/README.md.
    traineeDocs: [],
    seedScript: 'instructor/seed/make_seed.mjs',
    seedArgs: (appDir, outDir, traineeNo) => ['--app', appDir, '--out', outDir, '--trainee', traineeNo],
    seedOutputs: {
      manifest: 'seed-manifest.json',
      credentials: 'credentials.txt',
      answerKey: 'handover-answer-key.md',
    },
    // The Day-3 change request (a second POS vendor): the request, a sample and a stand-in server, as a PR from the client.
    handout: {
      sourcePath: 'instructor/day3-handout',
      targetPath: 'docs/requirements/vendor-b',
      branch: 'client/second-pos-vendor',
      commitMessage: 'docs: change request from the client — a second POS vendor',
      prTitle: 'Change request: a second POS vendor',
      prBody:
        'From the Suki Supply operations office. Four stores moved to another POS vendor. Read the request in this folder, add it to your requirements and design it, then plan it through EPAV like any other task. What works today must keep giving the same numbers.',
      label: 'Day-3 change request',
      instructions:
        "Opens the client's second-POS-vendor change request as a pull request on the trainee's repository. Send it to every trainee at the same time (Day 3, 13:00). Running it again reuses the same branch and PR.",
    },
    checks: {
      grade: {
        title: 'Grade (in the trainee lab)',
        needsSourceFiles: [
          'instructor/grader/grade.py',
          'instructor/grader/oracle.py',
          'instructor/grader/vendor_b.py',
          'instructor/gen/generator.py',
          'instructor/gen/source_server.py',
        ],
        job: ctx => ({
          image: PYTHON_LAB_IMAGE,
          files: {
            'grade.py': ctx.sourceFiles['instructor/grader/grade.py'],
            'oracle.py': ctx.sourceFiles['instructor/grader/oracle.py'],
            'vendor_b.py': ctx.sourceFiles['instructor/grader/vendor_b.py'],
            'generator.py': ctx.sourceFiles['instructor/gen/generator.py'],
            'source_server.py': ctx.sourceFiles['instructor/gen/source_server.py'],
            'run.sh': b64(PYTHON_A_GRADE_JOB_SCRIPT),
          },
          clone: { url: ctx.repoUrl, ref: 'capstone-final' },
          // The lab network: the grader reaches the lab's PostgreSQL as `postgres` and the object store as `objectstore`.
          networkOfService: 'postgres',
          command: ['bash', '/job/run.sh'],
          env: { DB_ADMIN_URL: PYTHON_A_LAB_DB_ADMIN_URL, S3_ENDPOINT: PYTHON_A_LAB_S3_ENDPOINT, TRAINEE_NO: ctx.traineeNo },
          outFile: 'out.json',
          // pip install of the trainee's package and the tools, then about a dozen runs (≈ 2 minutes on a laptop).
          timeoutMs: 25 * 60_000,
        }),
      },
    },
    gradeCommand:
      'Use "Grade (in the trainee lab)". By hand: pip install psycopg[binary] boto3, then python3 instructor/grader/grade.py --repo <clone of the capstone-final tag> --db-admin-url postgresql://<superuser>@<host>:5432/postgres --s3-endpoint <S3 URL> --json grade.json (generator.py and source_server.py from instructor/gen/ must be importable: the script finds them next to ../gen).',
  },
};

/**
 * The brownfield capstones were called nodejs, terraform and linux until they became -b (2026-11-02).
 * Old templates still send those ids, so they resolve to the -b definitions.
 */
export const LEGACY_CAPSTONE_IDS: Record<string, string> = { nodejs: 'nodejs-b', terraform: 'terraform-b', linux: 'linux-b' };

export function capstoneById(id: unknown): CapstoneDefinition | undefined {
  if (typeof id !== 'string') return undefined;
  const key = Object.prototype.hasOwnProperty.call(LEGACY_CAPSTONE_IDS, id) ? LEGACY_CAPSTONE_IDS[id] : id;
  return Object.prototype.hasOwnProperty.call(CAPSTONES, key) ? CAPSTONES[key] : undefined;
}
