#!/bin/bash
set -e

# ---------------------------------------------------------------------------
# Nexus IDP — one-command build & deploy
# Usage: ./scripts/deploy.sh
#
# Required env vars (or edit defaults below):
#   REGISTRY      — container registry (e.g. ghcr.io/your-org/backstage)
#   IMAGE_TAG     — image tag (default: latest)
#   K8S_NAMESPACE — Kubernetes namespace (default: backstage)
#   HEALTH_URL    — readiness endpoint to verify after deploy
# ---------------------------------------------------------------------------

REGISTRY=${REGISTRY:-"your-registry/backstage"}
IMAGE_TAG=${IMAGE_TAG:-"latest"}
K8S_NAMESPACE=${K8S_NAMESPACE:-"backstage"}
HEALTH_URL=${HEALTH_URL:-"http://localhost/.backstage/health/v1/readiness"}

cd "$(dirname "$0")/.."

echo "==> Pulling latest code..."
git pull origin main

echo "==> Building frontend + backend..."
export PATH="$(pwd)/node_modules/.bin:$PATH"
yarn build:backend

echo "==> Building Docker image..."
docker build . -f Dockerfile.with-migrations --tag "${REGISTRY}:${IMAGE_TAG}"

echo "==> Pushing image to registry..."
docker push "${REGISTRY}:${IMAGE_TAG}"

echo "==> Restarting deployment..."
kubectl rollout restart deployment/backstage -n "${K8S_NAMESPACE}"
kubectl rollout status deployment/backstage -n "${K8S_NAMESPACE}" --timeout=120s

echo "==> Verifying health..."
sleep 5
curl -sf "${HEALTH_URL}" && echo " Health check passed" || echo " Health check failed"

echo "==> Done."
