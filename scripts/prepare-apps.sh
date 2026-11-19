#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
REGION="${TF_VAR_aws_region:-${AWS_REGION:-us-east-1}}"

docker info >/dev/null

# You apply shared infrastructure first so the ECR repository exists.
if ! REPOSITORY_URL=$(terraform -chdir=terraform/shared output -raw api_check_repository_url); then
  echo "Apply terraform/shared first, then run npm run prepare:apps." >&2
  exit 1
fi

npm run build:job-api
REGISTRY="${REPOSITORY_URL%%/*}"
REPO="${REPOSITORY_URL#*/}"
TAG="$(date -u +%Y%m%d%H%M%S)-$$"
IMAGE="$REPOSITORY_URL:$TAG"

# Build and upload Tanishq's Lambda image.
aws ecr get-login-password --region "$REGION" |
  docker login --username AWS \
  --password-stdin "$REGISTRY"

docker buildx build --platform linux/amd64 --provenance=false --load \
  -t "$IMAGE" ./pentest
docker push "$IMAGE"

DIGEST=$(aws ecr describe-images \
  --region "$REGION" \
  --repository-name "$REPO" \
  --image-ids "imageTag=$TAG" \
  --query 'imageDetails[0].imageDigest' \
  --output text)

if [[ ! "$DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "Could not retrieve a valid ECR image digest" >&2
  exit 1
fi

# Save inputs for your later terraform plan/apply; this file is Git-ignored.
node - "$REGION" "$DIGEST" "${API_CHECK_TARGET_URL:-}" <<'NODE'
const fs = require('node:fs');
const [region, digest, target] = process.argv.slice(2);
const file = 'terraform/apps/image.auto.tfvars.json';
const variables = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
variables.aws_region = region;
variables.api_check_image_digest = digest;
if (target) variables.api_check_target_url = target;
fs.writeFileSync(file, JSON.stringify(variables, null, 2) + '\n');
NODE

echo "Ready. Run: terraform -chdir=terraform/apps apply"
