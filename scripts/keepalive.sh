#!/usr/bin/env bash
# GitHub disables scheduled workflows in a public repository after 60 days without activity.
# This re-enables every scheduled workflow (harmless when already enabled) and, when the last
# commit is 45 or more days old, pushes an empty commit so the 60-day clock starts again.
# Needs GH_TOKEN with actions:write and contents:write (the workflow's GITHUB_TOKEN is enough).
set -euo pipefail
for wf in .github/workflows/*.yml; do
  if grep -q "schedule:" "$wf"; then
    name="$(basename "$wf")"
    state="$(gh api "repos/$GITHUB_REPOSITORY/actions/workflows/$name" --jq .state 2>/dev/null || echo unknown)"
    if [ "$state" = "disabled_manually" ]; then
      echo "::warning::$name was disabled by hand; leaving it off"
    elif gh api -X PUT "repos/$GITHUB_REPOSITORY/actions/workflows/$name/enable" >/dev/null; then
      echo "enabled $name (was $state)"
    else
      echo "::warning::could not re-enable $name"
    fi
  fi
done
age=$(( ( $(date +%s) - $(git log -1 --format=%ct) ) / 86400 ))
echo "last commit: $age days ago"
if [ "$age" -ge 45 ]; then
  git config user.name "github-actions[bot]"
  git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
  git commit --allow-empty -m "Keep-alive: no commits for $age days [skip ci]"
  git push
fi
