# TODO — Stratpoint IDP Roadmap

## In Progress
- FinOps dashboard (`feature/finops-dashboard`)

---

## FinOps
- [ ] Cost allocation per team/project using resource tags
- [ ] Budget alerts — notify (Slack/email) when team approaches limit
- [ ] Cost anomaly detection — flag unusual spending spikes vs prior period
- [ ] Scheduled cleanup — let teams schedule unused resource deletion
- [ ] Multi-account view — dev/staging/prod AWS accounts
- [ ] Resource tagging enforcer — scan and report resources missing required tags (Owner, Team, Environment)
- [ ] Self-service cost visibility per catalog component — link Backstage services to AWS resources via tags
- [ ] Chargeback reporting — monthly cost report per team (CSV/PDF)

---

## Developer Self-Service
- [ ] Onboarding automation — new dev triggers portal to provision local env, create accounts, add to org groups
- [ ] Cloud environment provisioning (staging/dev) via agent pattern (extend local provisioner)

---

## Visibility
- [ ] CI/CD pipeline status per service (GitHub Actions integration)
- [ ] ArgoCD deployment status per service (token already in config)
- [ ] Kubernetes workload status plugin (k8s token already in config)
- [ ] Incident/alert tracking linked to catalog services

---

## Governance
- [ ] Tech radar — approved, trial, deprecated technologies across the org
- [ ] API catalog enforcement — ensure all services have registered APIs
- [ ] Service dependency tracking — flag deprecated dependencies

---

## Project Registration (High Priority)
- [ ] Implement backend for project registration plugin
- [ ] Jira integration — create board on project registration
- [ ] End-to-end flow: new project → Jira board + GitHub repo + catalog entry + local env provisioning
