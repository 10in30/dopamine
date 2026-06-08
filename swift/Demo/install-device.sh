#!/usr/bin/env bash
#
# Build DopamineDemo and install it onto a physical iPhone (macOS only).
#
# Mirrors the simulator path in README.md, but builds for a real device with
# automatic code signing (DEVELOPMENT_TEAM lives in project.yml) and installs
# via `devicectl` (Xcode 15+; replaces the deprecated `ios-deploy`).
#
# Usage:
#   ./install-device.sh                 # auto-pick the one connected device
#   ./install-device.sh <udid|name>     # target a specific device
#   LAUNCH=1 ./install-device.sh        # also foreground the app after install
#
# Note: autoplay is a simulator/CI affordance only — on a real device you pick an
# effect and tap Fire in-app, so there is no launch-time effect argument here.
#
# Requirements: Xcode, an iPhone paired & trusted over USB/Wi-Fi, and an Apple
# Developer account signed into Xcode for the team in project.yml.

set -euo pipefail
cd "$(dirname "$0")"

PROJECT="DopamineDemo.xcodeproj"
SCHEME="DopamineDemo"
BUNDLE_ID="ai.polyguard.DopamineDemo"
DERIVED="build"

# --- 1. Ensure XcodeGen, then (re)generate the project ----------------------
if ! command -v xcodegen >/dev/null 2>&1; then
  echo "==> xcodegen not found; installing via Homebrew"
  brew install xcodegen
fi
echo "==> xcodegen generate"
xcodegen generate

# --- 2. Resolve the target device UDID --------------------------------------
# `devicectl list devices` columns vary; grab the UUID-shaped token on each
# "available"/"connected" line. A name/udid argument filters to one device.
FILTER="${1:-}"
DEVICES_RAW="$(xcrun devicectl list devices 2>/dev/null)"

pick_udid() {
  # Print "UDID<TAB>rest-of-line" for usable, non-Watch device rows.
  echo "$DEVICES_RAW" \
    | grep -Ei 'available|connected' \
    | grep -viE 'watch' \
    | grep -Eo '[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}.*'
}

MATCHES="$(pick_udid || true)"
if [ -n "$FILTER" ]; then
  MATCHES="$(echo "$MATCHES" | grep -iF -- "$FILTER" || true)"
fi

COUNT="$(printf '%s\n' "$MATCHES" | grep -c . || true)"
if [ "$COUNT" -eq 0 ]; then
  echo "ERROR: no connected iOS device found${FILTER:+ matching '$FILTER'}." >&2
  echo "Connect & trust your iPhone, then check: xcrun devicectl list devices" >&2
  exit 1
fi
if [ "$COUNT" -gt 1 ] && [ -z "$FILTER" ]; then
  echo "ERROR: multiple devices connected — pass a name or UDID:" >&2
  printf '%s\n' "$MATCHES" >&2
  exit 1
fi

UDID="$(printf '%s\n' "$MATCHES" | head -1 | awk '{print $1}')"
echo "==> target device: $UDID"

# --- 3. Build for the device (signed) ---------------------------------------
# Build for the GENERIC iOS destination, not `id=$UDID`: `devicectl` and
# `xcodebuild` use DIFFERENT identifier namespaces for the same phone
# (devicectl → CoreDevice UUID; xcodebuild → hardware ECID), so the devicectl
# UDID never matches an `xcodebuild -destination id=…`. `generic/platform=iOS`
# sidesteps that — it produces a signed device .app without binding to one
# device, and we install it by the devicectl UDID below.
# -allowProvisioningUpdates lets Xcode register the device + mint the
# provisioning profile on first run. Signing settings come from project.yml.
echo "==> xcodebuild (generic iOS device)"
xcodebuild \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -destination "generic/platform=iOS" \
  -derivedDataPath "$DERIVED" \
  -allowProvisioningUpdates \
  build

# --- 4. Install the .app ----------------------------------------------------
APP="$(/usr/bin/find "$DERIVED/Build/Products" -name "$SCHEME.app" -type d | head -1)"
if [ -z "$APP" ]; then
  echo "ERROR: built .app not found under $DERIVED/Build/Products" >&2
  exit 1
fi
echo "==> installing: $APP"
# iOS won't mount the developer disk image (needed to install dev-signed apps)
# while the device is LOCKED. Retry briefly so a quick Face ID unlock succeeds
# without re-running the whole build.
for attempt in 1 2 3 4 5; do
  if xcrun devicectl device install app --device "$UDID" "$APP"; then
    break
  fi
  if [ "$attempt" -eq 5 ]; then
    echo "" >&2
    echo "ERROR: install failed. Most common cause: the iPhone is LOCKED." >&2
    echo "       Unlock it (and tap 'Trust' if prompted), then re-run this script." >&2
    echo "       Also verify: Settings ▸ Privacy & Security ▸ Developer Mode = On." >&2
    exit 1
  fi
  echo "   install failed (attempt $attempt) — UNLOCK your iPhone now; retrying in 5s…" >&2
  sleep 5
done

echo "==> done. Launch DopamineDemo from your Home Screen."

# --- 5. Optional: foreground the freshly installed app ----------------------
if [ -n "${LAUNCH:-}" ]; then
  echo "==> launching $BUNDLE_ID"
  xcrun devicectl device process launch --device "$UDID" "$BUNDLE_ID"
fi
