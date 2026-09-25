#!/usr/bin/env bash
# Push AgentOS to GitHub. Usage:
#   GITHUB_TOKEN=ghp_xxxx ./scripts/push.sh
# Or paste the token when prompted.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! git remote | grep -q origin; then
  TOKEN="${GITHUB_TOKEN:-}"
  if [ -z "$TOKEN" ]; then
    printf "GitHub Personal Access Token (repo scope): "
    read -rs TOKEN
    echo
  fi
  git remote add origin "https://${TOKEN}@github.com/abtrader00900/agentos.git"
  echo "✓ remote 'origin' added (abtrader00900/agentos)"
fi

BRANCH=$(git branch --show-current)
git push -u origin "$BRANCH"
echo "✓ pushed to origin/$BRANCH"
echo
echo "Next on github.com/abtrader00900/agentos:"
echo "  1. Convert to public repo (Settings → Danger Zone not needed; just visibility)"
echo "  2. Add topics: mcp, ai-agents, claude-code, codex, local-first"
echo "  3. Paste LAUNCH.md into a dev.to/Reddit post"
