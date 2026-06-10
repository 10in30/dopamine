#!/usr/bin/env bash
# Drive a BOOTED emulator: install the demo, autoplay all nine effects at slow-mo,
# screen-record the full sequence, and ffmpeg it back to real time. The analog of
# swift.yml's iOS `simctl recordVideo` step.
#
# WHY A SCRIPT FILE: `reactivecircus/android-emulator-runner`'s `script:` input is
# executed LINE BY LINE (each line as its own `sh -c`), so backslash line-
# continuations and multi-line `if`/`for` blocks break there. The workflow invokes
# this file with a SINGLE line (`bash android/ci/emulator-record.sh`), so all the
# real logic runs under one bash process where normal shell syntax works.
set -x

APK="android/demo/build/outputs/apk/debug/demo-debug.apk"
OUT="/tmp/out"
mkdir -p "$OUT"

adb install -r "$APK"

# Autoplay EVERY registered effect in sequence at quarter speed (like swift's
# `-autoplay all -slowmo 0.25`) so the emulator's low frame rate still samples each
# effect's motion smoothly. MUST be one line (am extras after the component).
adb shell am start -n ai.dopamine.demo/.MainActivity --es autoplay all --ef slowmo 0.25

sleep 3

# The demo cycles all nine (~11 s each at slow-mo); record one full sequence (~100 s)
# + margin. screenrecord captures SurfaceFlinger's composited output, so it sees the
# z-ordered translucent GLSurfaceView overlay; it auto-finalizes at --time-limit.
timeout 130 adb shell screenrecord --bit-rate 8000000 --time-limit 105 /sdcard/dopamine-slowmo.mp4 || true
sleep 2
adb pull /sdcard/dopamine-slowmo.mp4 "$OUT/dopamine-slowmo.mp4" || true

# Speed the clip back to real time (setpts * slowmo keeps every captured frame),
# mirroring swift.yml. Force even dimensions (libx264 yuv420p rejects odd). ffmpeg
# is installed by the workflow step before this; if it's somehow unavailable, or the
# re-encode fails, fall back to shipping the slow-mo clip as dopamine.mp4 so the
# artifact always exists.
#
# `screenrecord` writes a VARIABLE-frame-rate stream; `setpts` only rescales each
# frame's timestamp, so the 4×-sped output stays VFR with irregular PTS, and the
# CFR re-encode dropped the late frames — leaving the back half BLANK (the slow-mo
# source was fine). Resample onto a constant real-time rate with the `fps` filter
# (+ CFR) so every output frame lands on a uniform grid and the whole clip plays.
if [ -s "$OUT/dopamine-slowmo.mp4" ]; then
  if command -v ffmpeg >/dev/null 2>&1; then
    ffmpeg -y -hide_banner -i "$OUT/dopamine-slowmo.mp4" \
      -vf "setpts=0.25*PTS,scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30" \
      -fps_mode cfr -an -c:v libx264 -pix_fmt yuv420p "$OUT/dopamine.mp4" 2>&1 | tail -8 || true
  fi
  [ -s "$OUT/dopamine.mp4" ] || cp "$OUT/dopamine-slowmo.mp4" "$OUT/dopamine.mp4"
fi

# Diagnostics: prove the shaders compiled + the effects fired.
adb logcat -d | grep -iE 'Dopamine|GLES|shader|fired|create failed' | tail -80 > "$OUT/app.log" || true
echo "--- recorded files ---"
ls -la "$OUT" || true
