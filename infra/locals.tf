locals {
  name_prefix = "stratpoint-backstage-prod"

  # ── Tagging ─────────────────────────────────────────────────────────────────
  # All resources tagged with the APFP credit for cost attribution.
  # APFP_SANDBOX_03_02_2026 is the AWS Partner Funding Program credit applied
  # to account 746540123485. Tag every resource so Cost Explorer can filter.
  common_tags = {
    Project       = "backstage-idp"
    Environment   = "production"
    Owner         = "stratpoint-platform"
    ManagedBy     = "opentofu"
    CreditProgram = "APFP_SANDBOX_03_02_2026"
    CostCenter    = "platform-engineering"
    Repository    = "stratpoint-engineering/backstage-main"
  }
}
