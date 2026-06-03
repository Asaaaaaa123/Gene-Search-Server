#!/usr/bin/env bash
# One-time GitHub login + push master and main (run in your own terminal).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${HOME}/.local/bin:${PATH}"

cd "$REPO_ROOT"

if ! command -v gh >/dev/null 2>&1; then
  echo "Installing GitHub CLI to ~/.local/bin ..."
  mkdir -p "${HOME}/.local/bin"
  tmp="$(mktemp -d)"
  curl -fsSL "https://github.com/cli/cli/releases/download/v2.63.2/gh_2.63.2_linux_amd64.tar.gz" -o "${tmp}/gh.tgz"
  tar -xzf "${tmp}/gh.tgz" -C "${tmp}"
  cp "${tmp}/gh_2.63.2_linux_amd64/bin/gh" "${HOME}/.local/bin/gh"
  rm -rf "${tmp}"
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "Sign in to GitHub (browser opens or use the device code shown below):"
  gh auth login -h github.com -p https -w
fi

gh auth setup-git

echo "Pushing master and main ..."
git push origin master
git push origin main

echo "Done. Remote branches are up to date."
