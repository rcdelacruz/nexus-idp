# FinOps Dashboard

The FinOps dashboard gives you visibility into AWS cloud spending across all Stratpoint accounts. It helps identify idle resources, track costs by account, and make informed decisions about cloud usage.

---

## Access

The FinOps dashboard is restricted to **platform admins** and **team leads** (`*-lead` groups).

If you need access and don't have it, ask a platform admin to add you to the appropriate lead group in `stratpoint/org/groups.yaml`.

---

## Accounts

The dashboard covers three AWS accounts:

| Account | Purpose |
|---------|---------|
| **Non-Prod** | Staging, QA, development workloads |
| **Legacy** | Older infrastructure being phased out |
| **Production** | Live customer-facing workloads |

---

## What You Can See

### Cost Summary

Top-level spend per account for the current month vs. previous month. Useful for spotting unexpected spikes.

### Idle Resources

Resources that haven't had meaningful activity in the past 180 days:

| Resource Type | Idle Criteria |
|---------------|--------------|
| EC2 instances | Low CPU + network utilization |
| RDS databases | No connections |
| Load balancers | No requests |
| Elastic IPs | Unattached |

Idle resources are flagged for review — they may be candidates for termination to reduce costs.

### Resource Inventory

A browsable list of all AWS resources across accounts with cost attribution. Filter by account, region, or resource type.

---

## AWS Access Portal

For direct AWS console access, use the Stratpoint AWS Access Portal:

[stratpoint.awsapps.com/start](https://stratpoint.awsapps.com/start)

Log in with your Stratpoint Google account. Available roles depend on your team assignment.

---

## Cost Optimization Tips

- **Review idle resources monthly** — the dashboard flags them automatically
- **Right-size before scaling** — check utilization before increasing instance types
- **Use Non-Prod for development** — never run dev workloads in Production accounts
- **Tag your resources** — templates auto-tag with `app`, `owner`, and `environment`; untagged resources are harder to attribute

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| FinOps page shows "Access Denied" | You need a `*-lead` or `backstage-admins` group membership |
| Cost data is stale | Data is cached for 24 hours — check back tomorrow or contact a platform admin |
| Resource missing from inventory | It may be in an account not yet connected — contact a platform admin |
