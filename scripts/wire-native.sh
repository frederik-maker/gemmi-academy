#!/usr/bin/env bash
# Wires native/ Kotlin sources into the Capacitor-generated android/ tree.
#
# Capacitor 8's `cap add android` produces a Java-only scaffold. To run
# Kotlin (which we need for sherpa-onnx + MediaPipe LiteRT), we have to:
#   1. Add the Kotlin Gradle plugin to the root buildscript classpath.
#   2. Apply `kotlin-android` to the app module and set JVM target.
#   3. Replace the generated Java MainActivity with our Kotlin one that
#      registers our plugins.
#   4. Drop our .kt sources into the package directory.
#   5. Fetch the sherpa-onnx AAR (~56 MB, not on Maven Central) from the
#      k2-fsa/sherpa-onnx GitHub release, verify its sha256, and drop it
#      into android/app/libs/ so the flatDir repo in gemmi.gradle resolves
#      `implementation(name: 'sherpa-onnx-1.13.1', ext: 'aar')`.
#   6. Copy native/voice.config.json into android/app/src/main/assets/ so
#      the PiperTts plugin can read it at runtime.
#
# Run this AFTER `cap add android` and BEFORE `./gradlew assembleDebug`.
# Idempotent: re-running on an already-wired tree does nothing destructive.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NATIVE="$ROOT/native"
ANDROID="$ROOT/android"
PKG="$ANDROID/app/src/main/java/co/bussler/gemmi"
ASSETS="$ANDROID/app/src/main/assets"
LIBS="$ANDROID/app/libs"

# Pinned native dependency versions. Keep in sync with native/gemmi.gradle.
KOTLIN_VERSION="2.0.21"
SHERPA_VERSION="1.13.1"
SHERPA_SHA256="3a9b8dd27a95463c7878abf1444baaaa9c99d6fefdb21b2c11ff5ecd2a6e8ddd"

step() { printf "\n\033[1;36m▸\033[0m %s\n" "$*"; }
fail() { printf "\033[1;31m✗\033[0m %s\n" "$*" >&2; exit 1; }

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
# 5. Copy native/voice.config.json into Android assets so PiperTtsPlugin's
#    onLoad can read it.
# ---------------------------------------------------------------------------
step "Installing config JSONs into Android assets"
mkdir -p "$ASSETS"
for f in voice.config.json model.config.json; do
  if [[ -f "$NATIVE/$f" ]]; then
    cp "$NATIVE/$f" "$ASSETS/$f"
    echo "    ✓ wrote $f"
  else
    echo "    ⚠ native/$f missing; the corresponding plugin will fail at runtime"
  fi
done

# ---------------------------------------------------------------------------
# 6. Fetch sherpa-onnx-$SHERPA_VERSION.aar from the k2-fsa GitHub release
#    into android/app/libs/. We verify sha256 to avoid shipping a corrupt
#    or mismatched native lib. ~56 MB download; CI caches it via the
#    runner's network egress (no further caching wired yet — fine because
#    every CI run starts from scratch anyway).
# ---------------------------------------------------------------------------
step "Fetching sherpa-onnx $SHERPA_VERSION AAR"
mkdir -p "$LIBS"
AAR="$LIBS/sherpa-onnx-$SHERPA_VERSION.aar"
URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/v$SHERPA_VERSION/sherpa-onnx-$SHERPA_VERSION.aar"

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

if [[ -f "$AAR" ]] && [[ "$(sha256_of "$AAR")" == "$SHERPA_SHA256" ]]; then
  echo "    ✓ already present and sha256 matches"
else
  curl -fSL --retry 3 --retry-delay 2 -o "$AAR" "$URL"
  got="$(sha256_of "$AAR")"
  if [[ "$got" != "$SHERPA_SHA256" ]]; then
    rm -f "$AAR"
    fail "sha256 mismatch on sherpa-onnx-$SHERPA_VERSION.aar: expected $SHERPA_SHA256 got $got"
  fi
  echo "    ✓ downloaded $(du -h "$AAR" | cut -f1)"
fi

step "Wiring complete. Run: cd android && ./gradlew assembleDebug"
