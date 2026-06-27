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
REPO="$HERE/../.."
WEB_SRC="$REPO/packages/core/src"
# The canonical single-folder source (carries the data spine + toolchain keys; the
# web loader ignores the latter, exactly as the runtime does).
DOPE="$REPO/effects/solarbloom/solarbloom.dope.json"
FIXTURE_DIR="$HERE/../Tests/DopamineCoreTests/Fixtures"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# Refresh the test's `.dope` fixture to the PORTABLE bytes the effect actually
# ships (toolchain keys stripped — what the Swift loader sees in production), so the
# parity vector can't drift from the canonical source. Writes the file directly (no
# stdout), keeping this script's stdout = the parity JSON.
node -e '
  import("'"$REPO"'/tools/dopamine/src/build.mjs").then(async (m) => {
    const { readFile, writeFile } = await import("node:fs/promises");
    const doc = JSON.parse(await readFile("'"$DOPE"'", "utf8"));
    await writeFile("'"$FIXTURE_DIR"'/solarbloom.dope.json", m.portableDope(doc));
  });
' 1>&2

mkdir -p "$STAGE/engine" "$STAGE/framework"
sed 's/\.js"/.ts"/g' "$WEB_SRC/engine/seed.ts"  > "$STAGE/engine/seed.ts"
sed 's/\.js"/.ts"/g' "$WEB_SRC/engine/color.ts" > "$STAGE/engine/color.ts"
sed 's/\.js"/.ts"/g' "$WEB_SRC/engine/tempo.ts" > "$STAGE/engine/tempo.ts"
sed 's/\.js"/.ts"/g' "$WEB_SRC/framework/loader.ts" > "$STAGE/framework/loader.ts"
printf 'export interface BakedSdf { size: number; range: number; viewBox: [number,number,number,number]; data: string; }\n' \
  > "$STAGE/engine/sdf.ts"
cp "$HERE/dump-parity.ts" "$STAGE/dump-parity.ts"

cd "$STAGE"
node --experimental-strip-types dump-parity.ts "$DOPE"
