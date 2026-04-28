#!/usr/bin/env bash
set -euo pipefail

REPO="${REPO:-JWang975/codex}"
TAG="${TAG:-speak-flow-1.0}"
TITLE="${TITLE:-Speak flow 1.0}"
ZIP_PATH="${ZIP_PATH:-release/Speak-flow-1.0-macOS-arm64.zip}"

if ! command -v gh >/dev/null 2>&1; then
  echo "Missing GitHub CLI. Install it first: brew install gh" >&2
  exit 1
fi

gh auth status >/dev/null

if [ ! -f "$ZIP_PATH" ]; then
  echo "Missing $ZIP_PATH. Build or copy the release zip first." >&2
  exit 1
fi

git push origin main

if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  gh release upload "$TAG" "$ZIP_PATH" --repo "$REPO" --clobber
else
  gh release create "$TAG" "$ZIP_PATH" \
    --repo "$REPO" \
    --title "$TITLE" \
    --notes-file docs/release-notes.md
fi

echo "Published $TITLE to https://github.com/$REPO/releases/tag/$TAG"
