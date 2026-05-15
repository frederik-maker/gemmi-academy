#!/usr/bin/env bash
# Wires native/ Kotlin sources into the Capacitor-generated android/ tree.
#
# Capacitor 8's `cap add android` produces a Java-only scaffold. To run
# Kotlin (which we need for LiteRT-LM), we have to:
#   1. Add the Kotlin Gradle plugin to the root buildscript classpath.
#   2. Apply `kotlin-android` to the app module and set JVM target.
#   3. Replace the generated Java MainActivity with our Kotlin one that
#      registers our plugins.
#   4. Drop our .kt sources into the package directory.
#   5. Copy native/model.config.json into android/app/src/main/assets/ so
#      the GemmiTutor plugin (LiteRT) can read it at runtime.
#
# Run this AFTER `cap add android` and BEFORE `./gradlew assembleDebug`.
# Idempotent: re-running on an already-wired tree does nothing destructive.
#
# Previously this script also fetched the sherpa-onnx AAR (~56 MB) and
# extracted a Kazakh Piper TTS voice (~26 MB) into APK assets. Removed:
# sherpa-onnx SIGSEGV'd on downloaded voices in production and we now
# rely entirely on Android's built-in TextToSpeech. Cuts ~80 MB off the
# APK + ~56 MB off every CI run.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NATIVE="$ROOT/native"
ANDROID="$ROOT/android"
PKG="$ANDROID/app/src/main/java/co/bussler/gemmi"
ASSETS="$ANDROID/app/src/main/assets"
LIBS="$ANDROID/app/libs"

# Pinned native dependency versions. Keep in sync with native/gemmi.gradle.
# Kotlin 2.3.10 is the latest stable as of 2026-05 and the minimum that
# LiteRT-LM 0.11+ accepts — its AAR was compiled with metadata 2.3.0, and
# Kotlin compilers refuse to read AAR metadata FROM a newer version than
# they implement (the inverse is fine).
KOTLIN_VERSION="2.3.10"

step() { printf "\n\033[1;36m▸\033[0m %s\n" "$*"; }
fail() { printf "\033[1;31m✗\033[0m %s\n" "$*" >&2; exit 1; }

# Cross-platform sha256. macOS dev machines have `shasum`; Linux CI has
# `sha256sum`. Fall back to Python (always available) if neither exists.
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    python3 -c "import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest())" "$1"
  fi
}

[[ -d "$ANDROID" ]] || fail "android/ not found. Run: npx cap add android"
[[ -d "$NATIVE"  ]] || fail "native/ not found. Are you running from repo root?"

# ---------------------------------------------------------------------------
# 1. Patch android/build.gradle: add Kotlin gradle plugin to buildscript.
#    Anchor on the AGP classpath line, which Capacitor 8 always emits, so
#    the regex doesn't have to know any other context.
# ---------------------------------------------------------------------------
step "Patching android/build.gradle to add Kotlin classpath"
ROOT_GRADLE="$ANDROID/build.gradle"
if grep -q "kotlin-gradle-plugin" "$ROOT_GRADLE"; then
  echo "    ✓ Kotlin classpath already present"
else
  python3 - "$ROOT_GRADLE" "$KOTLIN_VERSION" <<'PY'
import pathlib, re, sys
p = pathlib.Path(sys.argv[1])
ver = sys.argv[2]
src = p.read_text()
m = re.search(r"^(\s*)classpath ['\"]com\.android\.tools\.build:gradle:.*?['\"]\s*$", src, re.M)
if not m:
    raise SystemExit("could not find AGP classpath line in " + str(p))
indent = m.group(1)
inject = f'{indent}classpath "org.jetbrains.kotlin:kotlin-gradle-plugin:{ver}"\n'
src = src[:m.end()] + "\n" + inject + src[m.end():]
p.write_text(src)
PY
  echo "    ✓ inserted kotlin-gradle-plugin:$KOTLIN_VERSION"
fi

# ---------------------------------------------------------------------------
# 2. Splice gemmi.gradle into android/app/build.gradle by appending one
#    apply-from line at the bottom. The splice file does the real work
#    (kotlin-android plugin, deps, kotlinOptions, ABI filter).
# ---------------------------------------------------------------------------
step "Installing gemmi.gradle into android/app/"
cp "$NATIVE/gemmi.gradle" "$ANDROID/app/gemmi.gradle"
APP_GRADLE="$ANDROID/app/build.gradle"
if grep -q "apply from: 'gemmi.gradle'" "$APP_GRADLE" || grep -q 'apply from: "gemmi.gradle"' "$APP_GRADLE"; then
  echo "    ✓ apply-from line already present"
else
  printf "\n// gemmi: native deps + Kotlin enablement\napply from: 'gemmi.gradle'\n" >> "$APP_GRADLE"
  echo "    ✓ appended apply-from line"
fi

# ---------------------------------------------------------------------------
# 3. Replace Java MainActivity with our Kotlin one (registers plugins).
# ---------------------------------------------------------------------------
step "Patching AndroidManifest for camera + mic permissions"
# The @capacitor/camera plugin reads its required CAMERA permission from
# its own manifest, but mic recording (WebSpeech / SpeechRecognition) is
# done from the WebView and needs RECORD_AUDIO declared by the app itself.
# Also add legacy WRITE_EXTERNAL_STORAGE for older Androids that gate
# camera-saved photos behind it.
MANIFEST="$ANDROID/app/src/main/AndroidManifest.xml"
if [[ -f "$MANIFEST" ]] && ! grep -q "android.permission.RECORD_AUDIO" "$MANIFEST"; then
  python3 - "$MANIFEST" <<'PY'
import pathlib, re, sys
p = pathlib.Path(sys.argv[1])
src = p.read_text()
inject = (
  '    <uses-permission android:name="android.permission.RECORD_AUDIO" />\n'
  '    <uses-permission android:name="android.permission.CAMERA" />\n'
  '    <uses-feature android:name="android.hardware.camera" android:required="false" />\n'
  '    <uses-feature android:name="android.hardware.microphone" android:required="false" />\n'
)
# Insert right before the existing INTERNET permission line.
src = re.sub(
  r'(    <uses-permission android:name="android\.permission\.INTERNET" />)',
  inject + r'\1',
  src,
  count=1,
)
p.write_text(src)
PY
  echo "    ✓ added RECORD_AUDIO + CAMERA permissions"
else
  echo "    ✓ already present"
fi

step "Patching styles.xml for light status bar + edge-to-edge insets"
# Status bar default = white text. The app's WebView body is white. Result:
# system clock + battery icons are invisible. Add windowLightStatusBar=true
# so the OS uses DARK icons on the light status bar, and force-translate
# WindowInsets to env(safe-area-inset-*) by enabling layoutInDisplayCutout.
STYLES="$ANDROID/app/src/main/res/values/styles.xml"
if [[ -f "$STYLES" ]] && ! grep -q "windowLightStatusBar" "$STYLES"; then
  python3 - "$STYLES" <<'PY'
import pathlib, re, sys
p = pathlib.Path(sys.argv[1])
src = p.read_text()
# Inject into the AppTheme.NoActionBarLaunch style block (the one the
# Activity uses). Status bar attrs there cover both launch and post-launch.
inject = '''
        <item name="android:windowLightStatusBar">true</item>
        <item name="android:statusBarColor">@android:color/transparent</item>
        <item name="android:windowLayoutInDisplayCutoutMode">shortEdges</item>
'''
src = re.sub(
    r'(<style name="AppTheme\.NoActionBarLaunch"[^>]*>)',
    r'\1' + inject,
    src,
    count=1,
)
# Also inject into AppTheme.NoActionBar (used post-splash) so the dark
# icons persist after the splash screen hands off.
src = re.sub(
    r'(<style name="AppTheme\.NoActionBar"[^>]*>)',
    r'\1' + inject,
    src,
    count=1,
)
p.write_text(src)
PY
  echo "    ✓ patched windowLightStatusBar + cutoutMode into both theme blocks"
else
  echo "    ✓ already patched"
fi

step "Replacing Java MainActivity with Kotlin"
mkdir -p "$PKG"
if [[ -f "$PKG/MainActivity.java" ]]; then
  rm "$PKG/MainActivity.java"
  echo "    ✓ removed MainActivity.java"
fi
cp "$NATIVE/MainActivity.kt" "$PKG/MainActivity.kt"
echo "    ✓ wrote MainActivity.kt"

# ---------------------------------------------------------------------------
# 4. Drop every native/*.kt plugin source into the package directory.
# ---------------------------------------------------------------------------
step "Copying Kotlin plugin sources"
for f in "$NATIVE"/*.kt; do
  name=$(basename "$f")
  [[ "$name" == "MainActivity.kt" ]] && continue
  cp "$f" "$PKG/$name"
  echo "    ✓ $name"
done

# ---------------------------------------------------------------------------
# 5. Copy native/model.config.json into Android assets so GemmiTutorPlugin
#    (LiteRT) can read it at runtime.
# ---------------------------------------------------------------------------
step "Installing model.config.json into Android assets"
mkdir -p "$ASSETS"
if [[ -f "$NATIVE/model.config.json" ]]; then
  cp "$NATIVE/model.config.json" "$ASSETS/model.config.json"
  echo "    ✓ wrote model.config.json"
else
  echo "    ⚠ native/model.config.json missing; GemmiTutor plugin will fail at runtime"
fi

step "Wiring complete. Run: cd android && ./gradlew assembleDebug"
