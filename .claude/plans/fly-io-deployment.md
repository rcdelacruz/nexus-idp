# Fly.io Deployment Plan for Backstage

## Overview

Deploy Backstage to Fly.io with:
- **Compute**: Fly.io VMs (free tier: 3 shared VMs)
- **Database**: Fly.io Postgres (free tier: 256MB RAM, 1GB storage)
- **Redis**: Upstash Redis (free tier: 10K commands/day)
- **Domain**: portal.stratpoint.io (custom domain)

## Prerequisites

### 1. Install Fly.io CLI

**macOS:**
```bash
brew install flyctl
```

**Other OS:**
```bash
curl -L https://fly.io/install.sh | sh
```

### 2. Sign Up and Login

```bash
flyctl auth signup
# or if you have an account
flyctl auth login
```

### 3. Add Payment Method (Required)

Even for free tier, Fly.io requires a credit card on file:
1. Go to https://fly.io/dashboard
2. Navigate to Billing
3. Add payment method (won't be charged on free tier)

## Implementation Steps

### Phase 1: Prepare Application for Deployment

#### Step 1: Create fly.toml Configuration

**File**: `fly.toml` (create at project root)

```toml
app = "backstage-stratpoint"
primary_region = "sin"  # Singapore (closest to PH)

[build]
  dockerfile = "build/prod/Dockerfile"

[env]
  NODE_ENV = "production"
  PORT = "7007"
  BACKEND_PORT = "7007"

[http_service]
  internal_port = 7007
  force_https = true
  auto_stop_machines = false
  auto_start_machines = true
  min_machines_running = 1

  [[http_service.checks]]
    interval = "30s"
    timeout = "5s"
    grace_period = "10s"
    method = "GET"
    path = "/healthcheck"

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 512

[[services]]
  protocol = "tcp"
  internal_port = 7007

  [[services.ports]]
    port = 80
    handlers = ["http"]
    force_https = true

  [[services.ports]]
    port = 443
    handlers = ["tls", "http"]

  [services.concurrency]
    type = "connections"
    hard_limit = 25
    soft_limit = 20
```

#### Step 2: Create .dockerignore

**File**: `.dockerignore`

```
node_modules/
.git/
.github/
dist/
dist-types/
coverage/
*.log
.env
.env.*
!.env.example
.secrets/
*.md
!README.md
docs/
.vscode/
.idea/
```

#### Step 3: Update Production Config for Fly.io

**File**: `app-config.production.yaml`

Add Fly.io specific configuration:

```yaml
backend:
  baseUrl: https://portal.stratpoint.io
  listen:
    port: ${PORT}
    host: 0.0.0.0
  database:
    client: pg
    connection:
      host: ${PGHOST}
      port: ${PGPORT}
      user: ${PGUSER}
      password: ${PGPASSWORD}
      database: ${PGDATABASE}
      ssl:
        rejectUnauthorized: false  # Fly.io internal SSL
  cache:
    store: redis
    connection: ${REDIS_URL}  # Upstash connection string

app:
  baseUrl: https://portal.stratpoint.io

auth:
  providers:
    google:
      production:
        clientId: ${AUTH_GOOGLE_CLIENT_ID}
        clientSecret: ${AUTH_GOOGLE_CLIENT_SECRET}
        callbackUrl: https://portal.stratpoint.io/api/auth/google/handler/frame
```

### Phase 2: Set Up Database (Fly.io Postgres)

#### Step 1: Create Postgres App

```bash
# Create Postgres cluster
flyctl postgres create \
  --name backstage-db \
  --region sin \
  --initial-cluster-size 1 \
  --vm-size shared-cpu-1x \
  --volume-size 1

# Note the connection details that appear
```

**Output will show:**
```
Username: postgres
Password: <generated-password>
Hostname: backstage-db.internal
Flycast: fdaa:X:X:X::X
Database: postgres
```

#### Step 2: Attach Database to App

```bash
# This will automatically set DATABASE_URL secret
flyctl postgres attach backstage-db --app backstage-stratpoint
```

This creates these secrets automatically:
- `DATABASE_URL` (full connection string)
- `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`

### Phase 3: Set Up Redis (Upstash)

#### Step 1: Create Upstash Redis via Fly.io

```bash
# Install Upstash extension
flyctl ext redis create \
  --name backstage-redis \
  --plan free \
  --region global

# Attach to your app
flyctl ext redis attach backstage-redis --app backstage-stratpoint
```

This automatically sets `REDIS_URL` secret.

**Alternative - Manual Upstash Setup:**
1. Go to https://console.upstash.com/
2. Sign up/login
3. Create Redis database (Global, free tier)
4. Copy connection string
5. Set as secret: `flyctl secrets set REDIS_URL="redis://..."`

### Phase 4: Set Secrets (Environment Variables)

```bash
# Navigate to project directory
cd /Users/ronalddelacruz/Projects/stratpoint/backstage-main-strat-eng

# Set secrets from your .env file
flyctl secrets set \
  BACKEND_SECRET="$(openssl rand -hex 32)" \
  AUTH_GOOGLE_CLIENT_ID="${AUTH_GOOGLE_CLIENT_ID}" \
  AUTH_GOOGLE_CLIENT_SECRET="${AUTH_GOOGLE_CLIENT_SECRET}" \
  AUTH_GOOGLE_ALLOWED_DOMAINS="stratpoint.com" \
  GITHUB_TOKEN="${GITHUB_TOKEN}" \
  GITLAB_TOKEN="${GITLAB_TOKEN}" \
  --app backstage-stratpoint

# Verify secrets are set
flyctl secrets list --app backstage-stratpoint
```

**Important Secrets Needed:**
- `BACKEND_SECRET` (session encryption)
- `AUTH_GOOGLE_CLIENT_ID` (Google OAuth)
- `AUTH_GOOGLE_CLIENT_SECRET` (Google OAuth)
- `AUTH_GOOGLE_ALLOWED_DOMAINS` (stratpoint.com)
- `GITHUB_TOKEN` (GitHub integration)
- `GITLAB_TOKEN` (GitLab integration - optional)
- `DATABASE_URL` (auto-set by postgres attach)
- `REDIS_URL` (auto-set by redis attach)

### Phase 5: Update Google OAuth Callback URL

Since you're deploying to production, update Google OAuth settings:

1. Go to https://console.cloud.google.com
2. Navigate to your OAuth client
3. Add authorized redirect URI:
   ```
   https://portal.stratpoint.io/api/auth/google/handler/frame
   ```

### Phase 6: Deploy Application

#### Step 1: Initial Deployment

```bash
# Deploy (this will build Docker image and push to Fly.io)
flyctl deploy --app backstage-stratpoint

# Watch deployment logs
flyctl logs --app backstage-stratpoint
```

**Build Process:**
1. Builds multi-stage Dockerfile (`build/prod/Dockerfile`)
2. Installs dependencies
3. Compiles TypeScript
4. Creates production bundle
5. Pushes image to Fly.io registry
6. Deploys to VMs

**First deploy takes ~10-15 minutes** (building TypeScript)

#### Step 2: Run Database Migrations

After first deployment, initialize the database:

```bash
# SSH into the running app
flyctl ssh console --app backstage-stratpoint

# Run migrations (if needed)
# Usually Backstage auto-migrates on startup
# Check logs to confirm: flyctl logs
```

### Phase 7: Configure Custom Domain

#### Step 1: Add Domain to Fly.io

```bash
# Add custom domain
flyctl certs create portal.stratpoint.io --app backstage-stratpoint
```

Fly.io will provide DNS instructions.

#### Step 2: Configure DNS Records

In your domain registrar (Namecheap, GoDaddy, Cloudflare, etc.):

**For Cloudflare/DNS Provider:**
1. Add CNAME record:
   ```
   Type: CNAME
   Name: portal
   Value: backstage-stratpoint.fly.dev
   TTL: Auto or 300
   Proxy: Disable (orange cloud off)
   ```

**OR use A/AAAA records** (if CNAME not supported):
```bash
# Fly.io will show these after adding cert
flyctl ips list --app backstage-stratpoint
```

Add:
- `A` record: portal.stratpoint.io → <IPv4>
- `AAAA` record: portal.stratpoint.io → <IPv6>

#### Step 3: Verify SSL Certificate

```bash
# Check cert status
flyctl certs show portal.stratpoint.io --app backstage-stratpoint

# Should show "Configured" after DNS propagates
```

DNS propagation can take 5-30 minutes.

### Phase 8: Verify Deployment

#### Check App Status
```bash
flyctl status --app backstage-stratpoint
```

#### View Logs
```bash
flyctl logs --app backstage-stratpoint
```

#### Access Application
1. **Fly.io domain**: https://backstage-stratpoint.fly.dev
2. **Custom domain** (after DNS): https://portal.stratpoint.io

#### Test Features
- ✅ Login with Google OAuth
- ✅ Catalog loads
- ✅ TechDocs accessible
- ✅ Scaffolder works
- ✅ Search functional

### Phase 9: Monitoring and Maintenance

#### View Metrics
```bash
flyctl dashboard --app backstage-stratpoint
```

Opens web dashboard with:
- CPU/Memory usage
- Request metrics
- Logs
- Deployment history

#### Scale Resources (if needed)

**Upgrade VM size:**
```bash
flyctl scale vm shared-cpu-2x --memory 1024 --app backstage-stratpoint
```

**Add more instances:**
```bash
flyctl scale count 2 --app backstage-stratpoint
```

**Free tier limits:**
- 3 shared VMs total across all apps
- 160GB bandwidth/month
- No credit card charges on free tier

#### Database Maintenance

**Check database status:**
```bash
flyctl postgres status --app backstage-db
```

**Backup database:**
Fly.io Postgres auto-backs up daily. Manual backup:
```bash
flyctl ssh console --app backstage-db
pg_dump -U postgres backstage > backup.sql
```

**Scale database (if needed):**
```bash
flyctl postgres update --vm-size dedicated-cpu-1x --app backstage-db
```

### Phase 10: CI/CD Automation (Optional)

Create GitHub Actions workflow for auto-deploy:

**File**: `.github/workflows/deploy.yml`

```yaml
name: Deploy to Fly.io

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: superfly/flyctl-actions/setup-flyctl@master

      - name: Deploy to Fly.io
        run: flyctl deploy --remote-only --app backstage-stratpoint
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

**Setup:**
1. Get Fly.io API token: `flyctl auth token`
2. Add to GitHub Secrets: `FLY_API_TOKEN`
3. Push to main branch → auto-deploys

## Rollback Strategy

### Quick Rollback to Previous Version

```bash
# List recent releases
flyctl releases --app backstage-stratpoint

# Rollback to specific version
flyctl releases rollback <version> --app backstage-stratpoint
```

### Emergency: Scale Down

If app is misbehaving:
```bash
# Scale to 0 instances (stop app)
flyctl scale count 0 --app backstage-stratpoint

# Fix issues, then scale back up
flyctl scale count 1 --app backstage-stratpoint
```

## Troubleshooting

### Issue: App won't start

**Check logs:**
```bash
flyctl logs --app backstage-stratpoint
```

**Common causes:**
- Missing environment variables
- Database connection failed
- Invalid app-config.yaml

### Issue: Database connection errors

**Verify database is attached:**
```bash
flyctl postgres list
flyctl secrets list --app backstage-stratpoint | grep PG
```

**Test connection:**
```bash
flyctl ssh console --app backstage-stratpoint
psql $DATABASE_URL
```

### Issue: OAuth redirect errors

**Check:**
1. Google OAuth redirect URI matches production URL
2. `AUTH_GOOGLE_CALLBACK_URL` secret is correct
3. Domain is properly configured and SSL cert is active

### Issue: Out of memory

**Symptoms:** App crashes, OOM errors in logs

**Solution:**
```bash
# Upgrade VM memory
flyctl scale vm shared-cpu-1x --memory 1024 --app backstage-stratpoint
```

## Cost Estimate

### Free Tier (Current Plan)
- **Fly.io VM**: Free (3 shared VMs total)
- **Postgres**: Free (256MB RAM, 1GB storage)
- **Upstash Redis**: Free (10K commands/day)
- **Bandwidth**: Free (160GB/month)
- **SSL Certificate**: Free

**Total: $0/month** (within free tier limits)

### If You Exceed Free Tier
- **Additional VMs**: ~$2/month each
- **Postgres upgrade**: $1.94/month (shared-cpu-1x, 3GB storage)
- **Bandwidth overage**: $0.02/GB
- **Upstash paid plan**: $0.20 per 100K commands

**Estimated: $5-10/month** for small production use

## Production Checklist

Before going live:

- [ ] Google OAuth configured for portal.stratpoint.io
- [ ] All secrets set in Fly.io
- [ ] Database attached and migrated
- [ ] Redis connected
- [ ] Custom domain DNS configured
- [ ] SSL certificate active
- [ ] Test login with Google
- [ ] Verify catalog loads
- [ ] Check TechDocs rendering
- [ ] Test scaffolder templates
- [ ] Monitor logs for errors
- [ ] Set up Uptime monitoring (UptimeRobot, etc.)

## Next Steps After Deployment

1. **Monitor Initial Usage**
   - Watch logs for first few days
   - Check resource usage in dashboard
   - Verify no memory leaks

2. **Set Up Backups**
   - Fly Postgres auto-backs up daily
   - Consider exporting backups externally

3. **Add Uptime Monitoring**
   - Use UptimeRobot (free) or Pingdom
   - Monitor https://portal.stratpoint.io/healthcheck

4. **Complete Google Workspace Integration**
   - After deployment stable, implement Google Workspace sync
   - Test with production users

## Critical Files

### New Files to Create
- `fly.toml` - Fly.io app configuration
- `.dockerignore` - Docker build exclusions
- `.github/workflows/deploy.yml` - CI/CD (optional)

### Modified Files
- `app-config.production.yaml` - Update for Fly.io environment variables
- Update Google OAuth settings in Google Cloud Console

## Summary

This plan deploys Backstage to Fly.io's free tier with:
- Managed PostgreSQL
- Serverless Redis
- Custom domain with SSL
- ~512MB RAM, 1 CPU
- Auto-scaling and health checks
- Zero cost (within free limits)

**Deployment time:** ~30-45 minutes for first deploy
**Ongoing maintenance:** Minimal (managed services)
