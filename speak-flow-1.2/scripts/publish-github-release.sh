#!/usr/bin/env bash
set -euo pipefail

REPO="${REPO:-JWang975/codex}"
BRANCH="${BRANCH:-main}"
TAG="${TAG:-speak-flow-1.2}"
TITLE="${TITLE:-Speak flow 1.2}"
COMMIT_MESSAGE="${COMMIT_MESSAGE:-Add Speak flow 1.2 release package}"

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ASSET_PATH="${ASSET_PATH:-$SOURCE_DIR/release/Speak-flow-1.2-macOS-arm64.dmg}"
WORKTREE_DIR="${WORKTREE_DIR:-$SOURCE_DIR/../codex-release-worktree}"

if ! command -v gh >/dev/null 2>&1; then
  echo "Missing GitHub CLI. Install it first, then run: gh auth login" >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "Missing git." >&2
  exit 1
fi

if ! command -v rsync >/dev/null 2>&1; then
  echo "Missing rsync." >&2
  exit 1
fi

gh auth status >/dev/null

if [ ! -f "$ASSET_PATH" ]; then
  echo "Missing $ASSET_PATH. Build the release DMG first." >&2
  exit 1
fi

if [ -d "$WORKTREE_DIR/.git" ]; then
  git -C "$WORKTREE_DIR" fetch origin "$BRANCH"
  git -C "$WORKTREE_DIR" checkout "$BRANCH"
  git -C "$WORKTREE_DIR" pull --ff-only origin "$BRANCH"
else
  git clone "https://github.com/$REPO.git" "$WORKTREE_DIR"
  git -C "$WORKTREE_DIR" checkout "$BRANCH"
fi

mkdir -p "$WORKTREE_DIR/$TAG"
rsync -a --delete \
  --exclude ".DS_Store" \
  --exclude "app/node_modules/" \
  --exclude "app/dist/" \
  --exclude "app/release/" \
  --exclude "app/data/settings.json" \
  --exclude "app/data/history.json" \
  --exclude "release/*.dmg" \
  --exclude "release/dmg-staging/" \
  "$SOURCE_DIR/" "$WORKTREE_DIR/$TAG/"

git -C "$WORKTREE_DIR" add "$TAG"
if git -C "$WORKTREE_DIR" diff --cached --quiet; then
  echo "No source snapshot changes to commit."
else
  git -C "$WORKTREE_DIR" commit -m "$COMMIT_MESSAGE"
  git -C "$WORKTREE_DIR" push origin "$BRANCH"
fi

if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  gh release upload "$TAG" "$ASSET_PATH" --repo "$REPO" --clobber
else
  gh release create "$TAG" "$ASSET_PATH" \
    --repo "$REPO" \
    --target "$BRANCH" \
    --title "$TITLE" \
    --notes-file "$SOURCE_DIR/docs/release-notes.md"
fi

echo "Published $TITLE to https://github.com/$REPO/releases/tag/$TAG"
