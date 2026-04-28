#!/bin/zsh
set -euo pipefail

cd "$(dirname "$0")"

APP_PATH="release/Speak flow.app"

if [ ! -d "$APP_PATH" ]; then
  echo "Building Speak flow.app..."
  COREPACK_ENABLE_AUTO_PIN=0 pnpm run app:build
fi

echo "Opening Speak flow..."
open -n "$APP_PATH"
