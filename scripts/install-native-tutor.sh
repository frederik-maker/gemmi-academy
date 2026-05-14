#!/usr/bin/env bash
# Wires the native/ scaffold into the Capacitor Android project.
#
# Prereqs:
#   - npm run android:init has been run once (creates ./android)
#   - native/model.config.json has been edited with your real model URLs + SHAs
#
# Idempotent: re-running just overwrites the Kotlin files and re-applies the
# Gradle splice. Safe to run after every fine-tune iteration.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NATIVE="$ROOT/native"
ANDROID="$ROOT/android"
PKG_PATH="$ANDROID/app/src/main/java/co/bussler/gemmi"
ASSETS="$ANDROID/app/src/main/assets"
GRADLE="$ANDROID/app/build.gradle"
GEMMI_GRADLE="$ANDROID/app/gemmi-tutor.gradle"
MAIN_ACTIVITY_DIR="$ANDROID/app/src/main/java"

step() { printf "\n\033[1;36m▸\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m▸\033[0m %s\n" "$*"; }
fail() { printf "\033[1;31m✗\033[0m %s\n" "$*" >&2; exit 1; }

[[ -d "$ANDROID" ]] || fail "android/ not found. Run: npm run android:init"
[[ -f "$NATIVE/model.config.json" ]] || fail "missing native/model.config.json"

if grep -q "REPLACE-ME\|REPLACE_WITH_SHA256" "$NATIVE/model.config.json"; then
  warn "model.config.json still has placeholders. The model download will fail until you fill them in."
fi

step "Copying Kotlin sources to $PKG_PATH"
mkdir -p "$PKG_PATH"
for f in GemmiTutorPlugin.kt GemmaRuntime.kt ChatTemplate.kt StreamingResponseParser.kt ModelDownloader.kt ToolBridge.kt; do
  cp "$NATIVE/$f" "$PKG_PATH/$f"
  echo "    ✓ $f"
done

step "Copying model.config.json to Android assets"
mkdir -p "$ASSETS"
cp "$NATIVE/model.config.json" "$ASSETS/model.config.json"

step "Splicing native/gemmi-tutor.gradle into $GRADLE"
# Robust approach: drop our extras into a separate gradle file and append a
# single `apply from:` line to the existing build.gradle. No regex hacking
# of Capacitor's generated dependencies block, which is fragile across CLI
# versions and broke last time we tried it.
cp "$NATIVE/gemmi-tutor.gradle" "$GEMMI_GRADLE"
echo "    ✓ wrote $GEMMI_GRADLE"
if grep -q "apply from: 'gemmi-tutor.gradle'" "$GRADLE" || grep -q 'apply from: "gemmi-tutor.gradle"' "$GRADLE"; then
  echo "    ✓ apply-from line already present"
else
  printf '\n// MARKER: gemmi-tutor-deps\napply from: "gemmi-tutor.gradle"\n' >> "$GRADLE"
  echo "    ✓ appended apply-from line"
fi

step "Registering plugin in MainActivity"
MAIN=$(find "$MAIN_ACTIVITY_DIR" -name MainActivity.java -o -name MainActivity.kt 2>/dev/null | head -1 || true)
[[ -n "$MAIN" ]] || fail "Could not find MainActivity in $MAIN_ACTIVITY_DIR"
if grep -q "GemmiTutorPlugin" "$MAIN"; then
  echo "    ✓ already registered"
else
  case "$MAIN" in
    *.java)
      python3 - "$MAIN" <<'PY'
import sys, re, pathlib
p = pathlib.Path(sys.argv[1])
src = p.read_text()
if "import co.bussler.gemmi.GemmiTutorPlugin;" not in src:
    src = re.sub(r"(package [^\n]+;\s*)", r"\1\nimport co.bussler.gemmi.GemmiTutorPlugin;\n", src, count=1)
src = re.sub(
    r"(public\s+void\s+onCreate\s*\([^)]*\)\s*\{\s*)(super\.onCreate)",
    r"\1registerPlugin(GemmiTutorPlugin.class);\n        \2",
    src, count=1,
)
p.write_text(src)
PY
      echo "    ✓ patched $MAIN (Java)"
      ;;
    *.kt)
      python3 - "$MAIN" <<'PY'
import sys, re, pathlib
p = pathlib.Path(sys.argv[1])
src = p.read_text()
if "import co.bussler.gemmi.GemmiTutorPlugin" not in src:
    src = re.sub(r"(package [^\n]+\s*)", r"\1\nimport co.bussler.gemmi.GemmiTutorPlugin\n", src, count=1)
src = re.sub(
    r"(override\s+fun\s+onCreate\s*\([^)]*\)\s*\{\s*)(super\.onCreate)",
    r"\1registerPlugin(GemmiTutorPlugin::class.java)\n        \2",
    src, count=1,
)
p.write_text(src)
PY
      echo "    ✓ patched $MAIN (Kotlin)"
      ;;
  esac
fi

step "Done."
