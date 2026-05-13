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
#
# Run this AFTER `cap add android` and BEFORE `./gradlew assembleDebug`.
# Idempotent: re-running on an already-wired tree does nothing destructive.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NATIVE="$ROOT/native"
ANDROID="$ROOT/android"
PKG="$ANDROID/app/src/main/java/co/bussler/gemmi"

step() { printf "\n\033[1;36m▸\033[0m %s\n" "$*"; }
fail() { printf "\033[1;31m✗\033[0m %s\n" "$*" >&2; exit 1; }

[[ -d "$ANDROID" ]] || fail "android/ not found. Run: npx cap add android"
[[ -d "$NATIVE"  ]] || fail "native/ not found. Are you running from repo root?"

# ---------------------------------------------------------------------------
# 1. Patch android/build.gradle: add Kotlin gradle plugin to buildscript.
#    We anchor the insert on the AGP classpath line, which Capacitor 8 always
#    emits, so the regex doesn't have to know any other context.
# ---------------------------------------------------------------------------
step "Patching android/build.gradle to add Kotlin classpath"
KOTLIN_VERSION="2.0.21"
ROOT_GRADLE="$ANDROID/build.gradle"
if grep -q "kotlin-gradle-plugin" "$ROOT_GRADLE"; then
  echo "    ✓ Kotlin classpath already present"
else
  python3 - "$ROOT_GRADLE" "$KOTLIN_VERSION" <<'PY'
import pathlib, re, sys
p = pathlib.Path(sys.argv[1])
ver = sys.argv[2]
src = p.read_text()
# Find the AGP classpath line and append a Kotlin one with the same indent.
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
#    `apply from:` line at the bottom. The splice file itself does the
#    real work (kotlin-android plugin, deps, kotlinOptions).
# ---------------------------------------------------------------------------
step "Installing gemmi.gradle into android/app/"
cp "$NATIVE/gemmi.gradle" "$ANDROID/app/gemmi.gradle"
APP_GRADLE="$ANDROID/app/build.gradle"
if grep -q "apply from: 'gemmi.gradle'" "$APP_GRADLE" || grep -q 'apply from: "gemmi.gradle"' "$APP_GRADLE"; then
  echo "    ✓ apply-from line already present"
else
  printf "\n// gemmi-tutor: native deps + Kotlin enablement\napply from: 'gemmi.gradle'\n" >> "$APP_GRADLE"
  echo "    ✓ appended apply-from line"
fi

# ---------------------------------------------------------------------------
# 3. Replace Java MainActivity with our Kotlin one. Capacitor 8 generates
#    MainActivity.java; for plugin registration we want Kotlin so the same
#    file can sit alongside our .kt plugin sources without inter-language
#    bridging quirks.
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
# 4. Drop every native/*.kt plugin source into the package directory. We
#    deliberately exclude MainActivity.kt (already copied above) and
#    HelloPlugin (for now, while we validate the toolchain — add real
#    plugins one at a time once the smoke test compiles).
# ---------------------------------------------------------------------------
step "Copying Kotlin plugin sources"
for f in "$NATIVE"/*.kt; do
  name=$(basename "$f")
  [[ "$name" == "MainActivity.kt" ]] && continue
  cp "$f" "$PKG/$name"
  echo "    ✓ $name"
done

step "Wiring complete. Run: cd android && ./gradlew assembleDebug"
