#!/usr/bin/env bash
# Dopamine — Claude Code on the web ENVIRONMENT setup script.
#
# Paste this into the environment's "setup script" field on code.claude.com. It
# runs at environment PROVISIONING (before the repo is cloned), so it is fully
# self-contained: it references NO repo files and installs only system toolchains.
# The container filesystem is cached afterward, so the ~783 MB Swift toolchain is
# downloaded ONCE and reused by every session in that environment.
#
# The base image already ships Node + npm (web stack) and Java 21 + Gradle (the
# Android `dopamine-core` JVM 192-case parity grid — no Android SDK needed). The
# missing pieces are a Swift toolchain for the swift/ package (`swift build` +
# `swift test` of DopamineCore + the parity grid; Metal stays behind
# `#if canImport(Metal)`, exactly like swift.yml's Linux job) and Python's
# `fonttools` + `brotli` so `dopamine build` can convert the shared woff2 display
# faces to the ttf the Swift/Android packages bundle.
#
# Requires a network policy that allows `download.swift.org` and the Ubuntu apt
# mirrors. Idempotent + non-interactive.
#
# Post-clone, install the web deps with `npm install` (fast; not done here because
# the repo isn't present yet at provisioning time).
set -euo pipefail

SWIFT_VERSION="6.0.3"
UBUNTU="ubuntu24.04"
SWIFT_HOME="/opt/swift-${SWIFT_VERSION}-RELEASE-${UBUNTU}"
SWIFT_BIN="${SWIFT_HOME}/usr/bin"

if [ ! -x "${SWIFT_BIN}/swift" ]; then
  echo "[dopamine] installing Swift ${SWIFT_VERSION} (${UBUNTU}) …"
  export DEBIAN_FRONTEND=noninteractive
  sudo apt-get update -qq
  sudo apt-get install -y --no-install-recommends \
    binutils git gnupg2 libc6-dev libcurl4-openssl-dev libedit2 libgcc-13-dev \
    libpython3-dev libsqlite3-0 libstdc++-13-dev libxml2-dev libz3-dev \
    pkg-config tzdata unzip zlib1g-dev
  tag="swift-${SWIFT_VERSION}-RELEASE"
  curl -fL --retry 3 -o /tmp/swift.tar.gz \
    "https://download.swift.org/swift-${SWIFT_VERSION}-release/${UBUNTU//./}/${tag}/${tag}-${UBUNTU}.tar.gz"
  sudo tar -xzf /tmp/swift.tar.gz -C /opt
  rm -f /tmp/swift.tar.gz
else
  echo "[dopamine] Swift ${SWIFT_VERSION} already installed (cached) — skipping."
fi

# Make `swift`/`swiftc` resolvable from any future shell two ways (belt + braces):
#  • symlinks in /usr/local/bin (already on PATH; the Swift driver locates its
#    toolchain via the resolved real path, so a symlink is fine), and
#  • a login-shell profile drop-in.
sudo ln -sf "${SWIFT_BIN}/swift"  /usr/local/bin/swift
sudo ln -sf "${SWIFT_BIN}/swiftc" /usr/local/bin/swiftc
echo "export PATH=\"${SWIFT_BIN}:\$PATH\"" | sudo tee /etc/profile.d/dopamine-swift.sh >/dev/null
export PATH="${SWIFT_BIN}:$PATH"

# fonttools + brotli for the woff2→ttf font conversion in `dopamine build`. Both
# are pure-Python wheels (no toolchain), so a quiet pip install suffices.
echo "[dopamine] installing fonttools + brotli (woff2→ttf for dopamine build) …"
python3 -m pip install --quiet --break-system-packages fonttools brotli 2>/dev/null \
  || python3 -m pip install --quiet fonttools brotli

echo "[dopamine] toolchains ready:"
echo "  node   $(node --version 2>/dev/null || echo MISSING)"
echo "  java   $(java -version 2>&1 | head -1 || echo MISSING)"
echo "  gradle $(gradle --version 2>/dev/null | awk '/^Gradle/{print $2}' || echo MISSING)"
echo "  swift  $(swift --version 2>/dev/null | head -1 || echo MISSING)"
echo "  python $(python3 --version 2>/dev/null || echo MISSING) ($(python3 -c 'import fontTools,brotli; print(\"fonttools\", fontTools.version)' 2>/dev/null || echo 'fonttools MISSING'))"
