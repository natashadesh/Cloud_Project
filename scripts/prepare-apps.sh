#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
REGION="${TF_VAR_aws_region:-${AWS_REGION:-us-east-1}}"

docker info >/dev/null

# You apply shared infrastructure first so both ECR repositories exist.
if ! API_CHECK_REPO_URL=$(terraform -chdir=terraform/shared output -raw api_check_repository_url) ||
   ! ANALYSIS_REPO_URL=$(terraform -chdir=terraform/shared output -raw analysis_repository_url); then
  echo "Apply terraform/shared first, then run npm run prepare:apps." >&2
  exit 1
fi

npm run build:job-api

REGISTRY="${API_CHECK_REPO_URL%%/*}"
aws ecr get-login-password --region "$REGION" |
  docker login --username AWS \
  --password-stdin "$REGISTRY"

# Build one Lambda image (x86_64), push it, and print its digest.
push_image() {
  local repository_url="$1" context_dir="$2"
  local repo="${repository_url#*/}"
  local tag
  tag="$(date -u +%Y%m%d%H%M%S)-$$"

  docker buildx build --platform linux/amd64 --provenance=false --load \
    -t "$repository_url:$tag" "$context_dir" >&2
  docker push "$repository_url:$tag" >&2

  local digest
  digest=$(aws ecr describe-images \
    --region "$REGION" \
    --repository-name "$repo" \
    --image-ids "imageTag=$tag" \
    --query 'imageDetails[0].imageDigest' \
    --output text)

  if [[ ! "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    echo "Could not retrieve a valid ECR image digest for $repo" >&2
    exit 1
  fi
  echo "$digest"
}

API_CHECK_DIGEST=$(push_image "$API_CHECK_REPO_URL" ./pentest)   # Tanishq's API-check worker
ANALYSIS_DIGEST=$(push_image "$ANALYSIS_REPO_URL" ./sast)        # Bhavan's analysis worker

# Save inputs for your later terraform plan/apply; this file is Git-ignored.
node - "$REGION" "$API_CHECK_DIGEST" "$ANALYSIS_DIGEST" "${API_CHECK_TARGET_URL:-}" <<'NODE'
const fs = require('node:fs');
const [region, apiCheckDigest, analysisDigest, target] = process.argv.slice(2);
const file = 'terraform/apps/image.auto.tfvars.json';
const variables = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
variables.aws_region = region;
variables.api_check_image_digest = apiCheckDigest;
variables.analysis_image_digest = analysisDigest;
if (target) variables.api_check_target_url = target;
fs.writeFileSync(file, JSON.stringify(variables, null, 2) + '\n');
NODE

echo "Ready. Run: terraform -chdir=terraform/apps apply"