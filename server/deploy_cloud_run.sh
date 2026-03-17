#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-}"
REGION="${REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-meowlingo-backend}"
ALLOW_UNAUTHENTICATED="${ALLOW_UNAUTHENTICATED:-true}"
MIN_INSTANCES="${MIN_INSTANCES:-0}"
MAX_INSTANCES="${MAX_INSTANCES:-2}"
MEMORY="${MEMORY:-2Gi}"
CPU="${CPU:-1}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "PROJECT_ID is required"
  exit 1
fi

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud CLI is required"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

gcloud config set project "$PROJECT_ID" >/dev/null
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com >/dev/null

DEPLOY_FLAGS=(
  --source "$SCRIPT_DIR"
  --region "$REGION"
  --platform managed
  --memory "$MEMORY"
  --cpu "$CPU"
  --min-instances "$MIN_INSTANCES"
  --max-instances "$MAX_INSTANCES"
  --quiet
)

if [[ "$ALLOW_UNAUTHENTICATED" == "true" ]]; then
  DEPLOY_FLAGS+=(--allow-unauthenticated)
else
  DEPLOY_FLAGS+=(--no-allow-unauthenticated)
fi

gcloud run deploy "$SERVICE_NAME" "${DEPLOY_FLAGS[@]}"

SERVICE_URL="$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format='value(status.url)')"
echo "SERVICE_NAME=$SERVICE_NAME"
echo "SERVICE_URL=$SERVICE_URL"
