#!/bin/bash
# Clear stale migration locks from PostgreSQL databases
# This is safe to run and only affects the knex_migrations_lock table

set -e

POSTGRES_HOST="postgres-cluster-rw.default.svc.cluster.local"
POSTGRES_PORT="5432"
POSTGRES_USER="backstage"

# Get password from secret
POSTGRES_PASSWORD=$(kubectl get secret -n backstage backstage-secrets -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d)

echo "Clearing migration locks from Backstage databases..."
echo ""

# Clear locks from both databases
for DB in "backstage" "backstage_plugin_local_provisioner"; do
    echo "Checking database: $DB"

    # Try to clear the lock
    kubectl run -n backstage pg-clear-lock-$RANDOM --rm -i --restart=Never \
        --image=postgres:13.3 \
        --env="PGPASSWORD=$POSTGRES_PASSWORD" \
        --command -- \
        psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$DB" \
        -c "DELETE FROM knex_migrations_lock WHERE is_locked = 1;" \
        -c "SELECT * FROM knex_migrations_lock;" 2>&1 | grep -v "pod.*deleted" || true

    echo ""
done

echo "✓ Migration locks cleared"
echo ""
echo "You can now redeploy Backstage"
