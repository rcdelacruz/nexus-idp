# FinOps Plugin Roadmap

**Created:** 2026-03-24
**Owner:** Ronald
**Guiding Principle:** One piece of the pie at a time. Phase 1 first — get visibility right before optimizing or governing.

---

## Phase 1 — Inform (Visibility) ← We are here

**Goal:** Single pane of glass. See everything across accounts and regions without touching AWS Console.

### 1A — Stabilize Multi-Region Scan (Local, now)
- [ ] Add per-region timeout (skip after 15s, flag as timed out in response)
- [ ] Add concurrency limit (3 regions at a time, not all 13 in parallel)
- [ ] Show scan progress in UI (which regions done, which timed out)
- **Effort:** Small — backend only

### 1B — Production-Grade Scan (After deploy)
- [ ] Use Backstage `SchedulerService` to run background scans every 6h per account
- [ ] Store results in Redis per `account + region` with timestamp
- [ ] Frontend loads instantly from cache — never waits for a scan
- [ ] "Last scanned: X ago" header + manual Refresh button
- [ ] Refresh triggers on-demand scan with SSE progress indicator
- **Effort:** Medium — scheduler + cache layer

### 1C — Inline Dependency Check (UX)
- [ ] Show blocker/warning count inline in the resource table (not just on click)
- [ ] Flag "safe to delete" vs "has dependencies" visually per row
- **Effort:** Small — frontend only

### 1E — Inline Tag Editor
- [ ] "Edit Tags" button per resource row
- [ ] Dialog shows current tags + fields for `team`, `owner`, `environment`
- [ ] Backend calls AWS tagging API per resource type (`CreateTags` for EC2/EBS/EIP, `PutBucketTagging` for S3, `AddTagsToResource` for RDS, `AddTags` for ELB)
- [ ] Row refreshes after save
- **Why:** Tag compliance flags the problem but gives no way to fix it. Closing the loop in the same UI is the right UX.
- **Effort:** Medium — backend tagging endpoints + frontend dialog

### 1D — Tag Compliance Visibility
- [ ] Show resources with no `team` / `owner` / `environment` tag
- [ ] These are "unattributed cost" — no one owns them
- [ ] Flag them separately from idle resources in the UI
- **Effort:** Small — backend filter + new UI section

---

## Phase 2 — Optimize (Cost Reduction)

**Goal:** Know where the waste is and who owns it.

### 2A — Cost Attribution to Teams
- [ ] Map AWS tag `team` → Backstage group
- [ ] Show cost breakdown per Backstage team
- [ ] "Team X spent $Y this month"
- **Effort:** Medium

### 2B — Backstage Catalog Integration
- [ ] Entity card on Team pages showing their AWS cost
- [ ] Component pages showing resource cost (if tagged with component name)
- **Effort:** Medium-Large

### 2C — Optimization Recommendations (enhance existing)
- [ ] Rightsizing already exists — connect it to the resource table
- [ ] Show "this EC2 could be downsized, saving $X/month" inline
- **Effort:** Small

---

## Phase 3 — Operate (Governance)

**Goal:** Enforce accountability. Teams own their costs.

### 3A — Budget Alerts per Team
- [ ] Team-level budgets tied to Backstage groups
- [ ] Notify (Slack/email) when team exceeds budget threshold
- **Effort:** Large

### 3B — Cleanup Workflows
- [ ] Request-based deletion (engineer requests, lead approves)
- [ ] Track cleanup history
- **Effort:** Large

---

## Current State

| Item | Status |
|---|---|
| Multi-account support | ✅ Done |
| Cost overview (trend, by service, by tag) | ✅ Done |
| Budget tracking | ✅ Done |
| Unused resource scanner (age-based filter) | ✅ Done |
| Rightsizing + RI + Savings Plans recommendations | ✅ Done |
| Multi-region scan (naive parallel) | ✅ Done (needs guards) |
| `last_fetched_at` per-account fix | ✅ Done |
| Region + Age columns in resource table | ✅ Done |
| "Beyond 1 year" threshold option | ✅ Done |
| Redis caching for unused resource scans | ✅ Done |
| Per-region scan timeout (30s) | ✅ Done |
| Delete resource with dependency check (blockers/warnings/info) | ✅ Done |
| Auto-release EIP on EC2 delete | ✅ Done |
| S3 force delete (empty bucket + delete) | ✅ Done |
| S3 CDN origin detection (CloudFront) | ✅ Done |
| S3 static website hosting detection | ✅ Done |
| Dependency check uses correct account | ✅ Done |
| Table sorting by any column | ✅ Done |
| Table horizontal overflow contained | ✅ Done |
| Active regions endpoint (per account, all resource types) | ✅ Done |
| Region dropdown grouped Active/Inactive per account | ✅ Done |
| Tag compliance visibility (untagged filter + missing tag chips) | ✅ Done |
| S3 empty/has-objects state detection | ✅ Done |
| Cache invalidation fixes (all known keys) | ✅ Done |
| **1E: Inline tag editor** | ✅ Done |
| **1A: Concurrency limit (3 regions at a time)** | 🔲 Next |
| **1B: SchedulerService background scan** | 🔲 After deploy |
| **1C: Inline dependency check in table row** | ⏭ Skipped |
| **1D: Tag compliance visibility** | ✅ Done |
| AWS Access Portal federation links | ✅ Done |
| 2A: Cost attribution to teams | 🔲 Future |
| 2B: Backstage catalog integration | 🔲 Future |
| 2C: Inline optimization recommendations | 🔲 Future |
| 3A: Budget alerts per team | 🔲 Future |
| 3B: Cleanup workflows | 🔲 Future |

---

## Architecture Decisions

### Multi-Region Scan Strategy
- **Local/dev:** On-demand scan with concurrency limit (3 regions at a time) + per-region timeout
- **Production:** Backstage `SchedulerService` background scan → Redis cache → instant frontend load
- **Rationale:** FinOps cleanup data doesn't need to be real-time. Hour-old data is fine for deletion decisions.

### AWS Rate Limit Protection
- Scan regions in batches of 3 (not all 13 at once)
- CloudWatch calls only made for resources that pass the creation-date filter
- Per-region timeout of 15s to prevent full hangs

### Catalog Integration Approach (Phase 2)
- Use AWS resource tags (`team`, `owner`) as the bridge to Backstage groups
- Tag compliance in Phase 1D is a prerequisite — untagged resources can't be attributed
