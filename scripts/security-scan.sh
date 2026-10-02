#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
report_dir="$repo_dir/reports/security"
semgrep_image="semgrep/semgrep:latest"
trivy_image="aquasec/trivy:latest"
zap_image="ghcr.io/zaproxy/zaproxy:stable"
mobsf_image="opensecurity/mobile-security-framework-mobsf:latest"

usage() {
  cat <<'EOF'
Usage: scripts/security-scan.sh <command> [target]

  code          Scan source code with Semgrep
  dependencies  Scan dependencies, configuration and tracked secrets with Trivy
  web [URL]     Run a passive ZAP baseline scan (default: local web on port 3000)
  mobile        Start the MobSF UI at http://127.0.0.1:8000
  mobile-stop   Stop the MobSF UI
  status        Show installed Docker images and MobSF status

Reports are written to reports/security/ (ignored by Git).
EOF
}

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "Docker Desktop must be running and accessible." >&2
  exit 1
fi

case "${1:-}" in
  code)
    mkdir -p "$report_dir"
    docker run --rm \
      -v "$repo_dir:/src:ro" \
      -v "$report_dir:/reports:rw" \
      -w /src \
      "$semgrep_image" \
      semgrep scan --config auto --json --output /reports/semgrep.json \
      --exclude '.env*' --exclude '**/.env*' \
      --exclude '**/node_modules/**' --exclude 'reports/**' \
      --exclude '.claude/worktrees/**' .
    echo "Semgrep report: $report_dir/semgrep.json"
    ;;
  dependencies)
    mkdir -p "$report_dir/trivy-cache"
    docker run --rm \
      -v "$repo_dir:/work:ro" \
      -v "$report_dir:/reports:rw" \
      -v "$report_dir/trivy-cache:/root/.cache/trivy:rw" \
      "$trivy_image" \
      fs --scanners vuln,misconfig,secret --include-dev-deps \
      --skip-files '/work/.env*' --skip-files '/work/**/.env*' \
      --skip-dirs '**/node_modules' --skip-dirs '**/.git' \
      --skip-dirs '/work/.claude/worktrees' \
      --skip-dirs '**/reports' --skip-dirs '**/.api-build' \
      --skip-dirs '**/.sites-runtime' --skip-dirs '**/.expo' \
      --skip-dirs '**/.vinext' --skip-dirs '**/.wrangler' \
      --skip-dirs '**/.next' --skip-dirs '**/dist' \
      --format json --output /reports/trivy.json /work
    echo "Trivy report: $report_dir/trivy.json"
    ;;
  web)
    mkdir -p "$report_dir"
    target="${2:-http://host.docker.internal:3000}"
    docker run --rm \
      -v "$report_dir:/zap/wrk:rw" \
      "$zap_image" \
      zap-baseline.py -t "$target" -m 1 -I \
      -J zap.json -r zap.html
    echo "ZAP reports: $report_dir/zap.json and $report_dir/zap.html"
    ;;
  mobile)
    if docker ps --format '{{.Names}}' | grep -Fxq derslik-mobsf; then
      echo "MobSF is already running at http://127.0.0.1:8000"
      exit 0
    fi
    docker run --rm --user 0 --entrypoint chown \
      -v derslik-mobsf-data:/home/mobsf/.MobSF \
      "$mobsf_image" -R 9901:9901 /home/mobsf/.MobSF
    docker run -d --rm \
      --name derslik-mobsf \
      -p 127.0.0.1:8000:8000 \
      -v derslik-mobsf-data:/home/mobsf/.MobSF \
      "$mobsf_image" >/dev/null
    echo "MobSF is starting at http://127.0.0.1:8000"
    ;;
  mobile-stop)
    docker stop derslik-mobsf
    ;;
  status)
    docker image ls --format '{{.Repository}}:{{.Tag}}' | \
      grep -E '^(semgrep/semgrep|aquasec/trivy|ghcr.io/zaproxy/zaproxy|opensecurity/mobile-security-framework-mobsf):' || true
    docker ps --filter name=derslik-mobsf --format 'MobSF: {{.Status}} ({{.Ports}})'
    ;;
  *)
    usage
    exit 2
    ;;
esac
