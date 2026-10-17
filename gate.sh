#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
npx tsc -p .
npx vitest run
if grep -rnE "@cf/cloudflare/(clairic|clef)" src test package.json; then
  echo "model ids must come from config, not source" >&2
  exit 1
fi
node -e '
const e = require("./receipts/eval.json").tasks.weakens_test;
const t = require("./receipts/terrarium-load.json");
const checks = {
  frozenBeforeRun: Boolean(e.frozen.at && e.frozen.holdout_sha256_16),
  holdoutScored: e.holdout.n > 0 && e.holdout.auc > 0.5,
  blockedInTerrarium: t.with_extension.judged.verdict === "block",
  allowedInTerrarium: t.normal_edit_with_extension.judged.verdict === "allow",
  extensionLoaded: t.loaded_events.length > 0 && t.loaded_events.every((x) => x.configured),
};
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
if (failed.length) { console.error("receipts do not prove it:", failed.join(", ")); process.exit(1); }
'
echo "write-judge gate: pass"
