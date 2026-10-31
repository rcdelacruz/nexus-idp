/**
 * Brownfield capstones the portal can seed per trainee. Each lives in a private training repo
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
  /** Also run by the scheduler (default true). Grading is instructor-only. */
  scheduled?: boolean;
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

function terraformGradeJob(phase: 'pre' | 'post', title: string): CapstoneCheck {
  return {
    title,
    scheduled: false,
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

export const CAPSTONES: Record<string, CapstoneDefinition> = {
  linux: {
    id: 'linux',
    title: 'Linux Capstone: Inherited Production Server Rescue',
    seedMode: 'laptop',
    laptopSeedFiles: ['instructor/seed/break_etl01.sh'],
    sourceRepo: 'strat-training/linux-training-capstone',
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
        scheduled: false,
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
  nodejs: {
    id: 'nodejs',
    title: 'Node.js Capstone B: Inherited API Rescue',
    seedMode: 'server',
    sourceRepo: 'strat-training/nodejs-training-capstone',
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
    gradeCommand:
      'node instructor/seed/grade.mjs --manifest <manifest.json> --credentials <credentials.txt> --repo <trainee-repo-clone> --json grade.json',
  },
  terraform: {
    id: 'terraform',
    title: 'Terraform Capstone: Brownfield-to-Platform Migration',
    seedMode: 'laptop',
    laptopSeedFiles: ['instructor/seed/seed_prod.py'],
    selfHostedRunner: true,
    sourceRepo: 'strat-training/terraform-training-capstone',
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
};

export function capstoneById(id: unknown): CapstoneDefinition | undefined {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(CAPSTONES, id) ? CAPSTONES[id] : undefined;
}
