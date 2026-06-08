#!/usr/bin/env bash
# Regenerate the cross-platform parity fixture from the WEB loader (ground truth).
#
# Stages the three web TS files the loader needs (engine/seed.ts, engine/color.ts,
# framework/loader.ts) with their `.js` import specifiers rewritten to `.ts`, plus
# a tiny stub for the type-only `engine/sdf.ts`, so Node's `--experimental-strip-
# types` can run them directly with no build step. Then runs dump-parity.ts.
#
# Usage (from swift/Scripts):
#   ./regen-parity.sh > ../Tests/DopamineCoreTests/Fixtures/solarbloom-parity.json
#
# Requires Node >= 22 (for --experimental-strip-types).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WEB_SRC="$HERE/../../packages/core/src"
DOPE="$HERE/../../packages/effect-solarbloom/src/solarbloom.dope.json"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$STAGE/engine" "$STAGE/framework"
sed 's/\.js"/.ts"/g' "$WEB_SRC/engine/seed.ts"  > "$STAGE/engine/seed.ts"
sed 's/\.js"/.ts"/g' "$WEB_SRC/engine/color.ts" > "$STAGE/engine/color.ts"
sed 's/\.js"/.ts"/g' "$WEB_SRC/framework/loader.ts" > "$STAGE/framework/loader.ts"
printf 'export interface BakedSdf { size: number; range: number; viewBox: [number,number,number,number]; data: string; }\n' \
  > "$STAGE/engine/sdf.ts"
cp "$HERE/dump-parity.ts" "$STAGE/dump-parity.ts"

cd "$STAGE"
node --experimental-strip-types dump-parity.ts "$DOPE"
