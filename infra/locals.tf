locals {
  name_prefix = "backstage-prod"

  # ── Tagging ─────────────────────────────────────────────────────────────────
  # Tag every resource so Cost Explorer can filter. Replace with your own values.
  common_tags = {
    Project       = "backstage-idp"
    Environment   = "production"
    Owner         = "platform-team"
    ManagedBy     = "opentofu"
    CostCenter    = "platform-engineering"
    Repository    = "your-org/your-repo"
  }
}
