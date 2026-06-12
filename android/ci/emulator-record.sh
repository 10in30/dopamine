#!/usr/bin/env bash
# Drive a BOOTED emulator: install the demo, then record EVERY effect as its own
# clip — recorder rolling BEFORE the fire, per-effect dwell driven by the app's
# own resolved durationMs (the `autoplay-done <name>` logcat handshake) — and
# convert each to a real-time mp4 + a gallery GIF. The full-sequence
# `dopamine.mp4` artifact is concatenated from the per-effect clips.
#
# WHY A SCRIPT FILE: `reactivecircus/android-emulator-runner`'s `script:` input is
# executed LINE BY LINE (each line as its own `sh -c`), so backslash line-
# continuations and multi-line `if`/`for` blocks break there. The workflow invokes
# this file with a SINGLE line (`bash android/ci/emulator-record.sh`), so all the
# real logic runs under one bash process where normal shell syntax works.
#
# THE THREE OLD CAPTURE DEFECTS THIS FLOW FIXES:
#   1. fixed-duration cycling — the demo now dwells per effect (resolved
#      durationMs / slowmo + gap; MainActivity.fire), instead of a flat 2800 ms.
#   2. missed start — screenrecord starts FIRST and the fire comes ~2 s later, so
#      the opening frames of every effect are on tape (the old flow launched the
#      app, then started recording, losing the first effect's start).
#   3. slow-mo conversion jank — screenrecord writes a VARIABLE-frame-rate stream
#      (frames only on surface updates); `setpts` alone keeps it VFR with
#      irregular, tightly-packed PTS, and a naive CFR re-encode dropped the late
#      frames (blank back half). The fix: normalize the start (PTS-STARTPTS),
#      compress timestamps by the slow-mo factor, THEN resample onto a constant
#      30 fps grid with the `fps` filter + `-fps_mode cfr` so every output frame
#      lands on a uniform timeline.
set -x

APK="android/demo/build/outputs/apk/debug/demo-debug.apk"
OUT="/tmp/out"
MEDIA="/tmp/media/android"
SLOWMO="${SLOWMO:-0.25}"
mkdir -p "$OUT" "$MEDIA"

adb install -r "$APK"

# Warm the app once OUTSIDE any recording (a cold start would eat into the first
# effect's clip). The huge startDelayMs parks it idle on the card; each singleTop
# relaunch below replaces that pending fire.
adb shell am start -n ai.dopamine.demo/.MainActivity --el startDelayMs 600000
sleep 6

# One recording per effect — STRUCTURAL segmentation (no guessing offsets in one
# long clip). The effect list is the single-folder model itself.
EFFECTS=$(ls effects)
for name in $EFFECTS; do
  adb logcat -c || true

  # Recorder first, fire second. screenrecord captures SurfaceFlinger's composited
  # output (it sees the z-ordered translucent GLSurfaceView overlay) and finalizes
  # its moov on SIGINT or --time-limit.
  adb shell "screenrecord --bit-rate 6000000 --time-limit 120 /sdcard/fx-$name.mp4" &
  RECPID=$!
  sleep 2

  # singleTop relaunch → onNewIntent → play THIS effect once at the card, at
  # slow-mo, then log the handshake.
  adb shell am start -n ai.dopamine.demo/.MainActivity --es autoplay "$name" --ef slowmo "$SLOWMO"

  # Wait for the app's own completion handshake (it knows the resolved
  # durationMs); hard cap as a fallback.
  for i in $(seq 1 90); do
    if adb logcat -d | grep -q "autoplay-done $name"; then break; fi
    sleep 1
  done
  sleep 1   # fade tail + encoder flush

  adb shell pkill -2 screenrecord || adb shell pkill -INT screenrecord || true
  wait "$RECPID" || true
  sleep 1
  adb pull "/sdcard/fx-$name.mp4" "$OUT/fx-$name-slowmo.mp4" || continue

  if command -v ffmpeg >/dev/null 2>&1; then
    # VFR slow-mo → CFR real time (defect 3 above). Even dims for libx264 yuv420p.
    ffmpeg -y -hide_banner -i "$OUT/fx-$name-slowmo.mp4" \
      -vf "setpts=(PTS-STARTPTS)*$SLOWMO,scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30" \
      -fps_mode cfr -an -c:v libx264 -pix_fmt yuv420p "$OUT/fx-$name.mp4" 2>&1 | tail -4 || true
    # Gallery GIF: crop the centered 4:5 region around the card, 380 px wide,
    # 12 fps, palette-optimized — mirrors scripts/media.mjs's web GIFs.
    if [ -s "$OUT/fx-$name.mp4" ]; then
      ffmpeg -y -hide_banner -i "$OUT/fx-$name.mp4" \
        -vf "crop=iw:min(ih\,iw*5/4):0:(ih-min(ih\,iw*5/4))/2,fps=12,scale=380:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3" \
        -loop 0 "$MEDIA/$name.gif" 2>&1 | tail -4 || true
    fi
  fi
  rm -f "$OUT/fx-$name-slowmo.mp4"
done

# The full-sequence artifact (dopamine.mp4, the pre-existing clip consumers see):
# concat the real-time per-effect clips (uniform 30 fps/size — same encode).
if command -v ffmpeg >/dev/null 2>&1; then
  LIST="$OUT/concat.txt"; rm -f "$LIST"
  for name in $EFFECTS; do
    if [ -s "$OUT/fx-$name.mp4" ]; then echo "file 'fx-$name.mp4'" >> "$LIST"; fi
  done
  if [ -s "$LIST" ]; then
    (cd "$OUT" && ffmpeg -y -hide_banner -f concat -safe 0 -i concat.txt -c:v libx264 -pix_fmt yuv420p -an dopamine.mp4 2>&1 | tail -4) || true
  fi
fi

# Diagnostics: prove the shaders compiled + the effects fired (full-session log —
# per-effect logcat was cleared each loop, so dump whatever remains plus dmesg-ish
# markers from the last effect, and the GIF/clip inventory).
adb logcat -d | grep -iE 'Dopamine|GLES|shader|fired|create failed' | tail -120 > "$OUT/app.log" || true
echo "--- recorded files ---"
ls -la "$OUT" "$MEDIA" || true
