#!/usr/bin/env bash
# Installs the APK on a running emulator, opens a new canvas, draws a stroke and checks that the app
# is still running without a crash. Usage: scripts/android-smoke.sh <apk> <output-dir>
set -euo pipefail
apk="$1"
out="$2"
pkg=app.canvasforge
mkdir -p "$out"

# Whatever happens, keep a screenshot, the log and the WebView version for the CI artifact.
collect() {
  adb exec-out screencap -p >"$out/screenshot.png" 2>/dev/null || true
  adb logcat -d >"$out/logcat.txt" 2>/dev/null || true
  adb shell dumpsys webviewupdate >"$out/webview.txt" 2>/dev/null || true
  grep -i "current webview package" -A1 "$out/webview.txt" || true
  grep "Capacitor/Console\|chromium" "$out/logcat.txt" | tail -40 || true
}
trap collect EXIT

adb wait-for-device
adb install -r "$apk"
adb logcat -c
adb shell am start -W -n "$pkg/.MainActivity"

# Centre of the first on-screen element whose text or description contains $1 (from a UI dump).
find_center() {
  for _ in $(seq 1 30); do
    adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 || true
    adb pull /sdcard/ui.xml "$out/ui.xml" >/dev/null 2>&1 || true
    if [ -f "$out/ui.xml" ]; then
      xy=$(python3 - "$out/ui.xml" "$1" <<'EOF'
import re, sys, xml.etree.ElementTree as ET
needle = sys.argv[2]
for n in ET.parse(sys.argv[1]).iter('node'):
    if needle in (n.get('text') or '') or needle in (n.get('content-desc') or ''):
        x1, y1, x2, y2 = map(int, re.findall(r'\d+', n.get('bounds')))
        print((x1 + x2) // 2, (y1 + y2) // 2)
        break
EOF
)
      if [ -n "$xy" ]; then
        echo "$xy"
        return 0
      fi
    fi
    sleep 2
  done
  echo "Not found on screen: $1" >&2
  return 1
}

read -r x y < <(find_center 'New canvas')
adb shell input tap "$x" "$y"
sleep 2
adb exec-out screencap -p >"$out/after-new-canvas-tap.png"
read -r x y < <(find_center 'Create')
adb shell input tap "$x" "$y"
sleep 3

size=$(adb shell wm size | grep -o '[0-9]*x[0-9]*' | tail -1)
w=${size%x*}
h=${size#*x}
adb shell input swipe $((w * 35 / 100)) $((h / 2)) $((w * 65 / 100)) $((h / 2)) 800
sleep 2

collect
trap - EXIT

if ! adb shell pidof "$pkg" >/dev/null; then
  echo "The app is not running."
  exit 1
fi
if grep -q "FATAL EXCEPTION" "$out/logcat.txt"; then
  grep -A 20 "FATAL EXCEPTION" "$out/logcat.txt"
  exit 1
fi
if grep "Capacitor/Console" "$out/logcat.txt" | grep -qi "error"; then
  grep "Capacitor/Console" "$out/logcat.txt" | grep -i "error"
  exit 1
fi
echo "App started, a canvas was created and a stroke drawn; no crash or console errors."
