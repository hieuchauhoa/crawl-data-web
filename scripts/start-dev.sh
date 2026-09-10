#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

if [[ ! -d node_modules ]]; then
  echo "Installing npm dependencies..."
  npm install
fi

if [[ ! -f apps/server/.env ]]; then
  cp apps/server/.env.example apps/server/.env
  echo "Created apps/server/.env"
  echo "Edit MARIADB_USER/MARIADB_PASSWORD, then run ./scripts/start-dev.sh again."
  exit 1
fi

npm run dev
