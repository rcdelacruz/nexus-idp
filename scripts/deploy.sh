#!/bin/bash
set -e

cd "$(dirname "$0")/.."

echo "==> Pulling latest code..."
git pull origin develop

echo "==> Building frontend + backend..."
export PATH="$(pwd)/node_modules/.bin:$PATH"
yarn workspace app build && yarn build:backend

echo "==> Building Docker image..."
docker build . -f Dockerfile.with-migrations \
  --build-arg BASE_IMAGE="${REGISTRY:?set REGISTRY, e.g. your-registry.example.com:5000}/backstage:latest" \
  --tag backstage:built

echo "==> Flattening image (prevent overlay layer accumulation)..."
CID=$(docker create backstage:built)
docker export "$CID" | docker import \
  --change 'USER node' \
  --change 'WORKDIR /app' \
  --change 'CMD ["node", "packages/backend", "--config", "app-config.yaml", "--config", "app-config.production.yaml", "--config", "app-config.on-prem.yaml"]' \
  - ${REGISTRY:?set REGISTRY, e.g. your-registry.example.com:5000}/backstage:latest
docker rm "$CID"
docker rmi backstage:built

echo "==> Pushing image to registry..."
docker push ${REGISTRY:?set REGISTRY, e.g. your-registry.example.com:5000}/backstage:latest

echo "==> Applying deployment manifest..."
kubectl apply -f k8s-manifests/backstage-deployment.yaml

echo "==> Restarting deployment..."
kubectl rollout restart deployment/backstage -n backstage
kubectl rollout status deployment/backstage -n backstage --timeout=120s

echo "==> Verifying health..."
sleep 5
curl -sf "http://${HEALTHCHECK_HOST:?set HEALTHCHECK_HOST, e.g. the service's cluster IP or a port-forwarded localhost}/.backstage/health/v1/readiness" && echo " Health check passed" || echo " Health check failed"

echo "==> Done."
