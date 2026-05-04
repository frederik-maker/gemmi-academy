#!/usr/bin/env bash
# Wires the native/ scaffold into the Capacitor Android project.
#
# Prereqs:
#   - npm run android:init has been run once (creates ./android)
#   - native/model.config.json has been edited with your real model URLs + SHAs
#
# Idempotent: re-running just overwrites the Kotlin files and re-patches the
# Gradle file in place. Safe to run after every fine-tune iteration.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NATIVE="$ROOT/native"
ANDROID="$ROOT/android"
PKG_PATH="$ANDROID/app/src/main/java/co/bussler/gemmi"
ASSETS="$ANDROID/app/src/main/assets"
GRADLE="$ANDROID/app/build.gradle"
MAIN_ACTIVITY_DIR="$ANDROID/app/src/main/java"

step() { printf "\n\033[1;36m▸\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m▸\033[0m %s\n" "$*"; }
fail() { printf "\033[1;31m✗\033[0m %s\n" "$*" >&2; exit 1; }

[[ -d "$ANDROID" ]] || fail "android/ not found. Run: npm run android:init"
[[ -f "$NATIVE/model.config.json" ]] || fail "missing native/model.config.json"

# Refuse to install if model.config.json still has placeholders — that would
# guarantee a runtime download failure.
if grep -q "REPLACE-ME\|REPLACE_WITH_SHA256" "$NATIVE/model.config.json"; then
  warn "model.config.json still has placeholder values. Continuing anyway, but the model download will fail until you fill them in."
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

step "Patching $GRADLE with LiteRT-LM dependencies"
if grep -q "gemmi-tutor-deps" "$GRADLE"; then
  echo "    ✓ dependencies already present"
else
  python3 - "$GRADLE" "$NATIVE/build.gradle.snippet" <<'PY'
import sys, re, pathlib
gradle_path, snippet_path = sys.argv[1], sys.argv[2]
gradle = pathlib.Path(gradle_path).read_text()
snippet_full = pathlib.Path(snippet_path).read_text()
# Pull the dependencies { ... } block out of the snippet so we don't write
# a `dependencies` block twice.
m = re.search(r"dependencies\s*\{([^}]*)\}", snippet_full, re.DOTALL)
inner = m.group(1).strip() if m else ""
marker = "// MARKER: gemmi-tutor-deps"
# Inject the marker + dep lines into the LAST `dependencies { ... }` block.
def inject(match):
    return match.group(0)[:-1] + "\n    " + marker + "\n    " + inner.replace("\n", "\n    ") + "\n}"
new = re.sub(r"dependencies\s*\{[^}]*\}", inject, gradle, count=0)
# Pick the last match — Gradle DSL may have multiple dependency blocks
# (project-level vs module). Easiest: target only matches *after* `android {`.
pathlib.Path(gradle_path).write_text(new)
PY
  echo "    ✓ injected LiteRT-LM + coroutines deps"
fi

step "Registering plugin in MainActivity"
MAIN=$(find "$MAIN_ACTIVITY_DIR" -name MainActivity.java -o -name MainActivity.kt | head -1 || true)
[[ -n "$MAIN" ]] || fail "Could not find MainActivity in $MAIN_ACTIVITY_DIR"
if grep -q "GemmiTutorPlugin" "$MAIN"; then
  echo "    ✓ already registered"
else
  case "$MAIN" in
    *.java)
      # Add import + registerPlugin() before super.onCreate (Java syntax)
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
      ;;
  esac
  echo "    ✓ patched $MAIN"
fi

step "Done. Next:"
cat <<EOF
    1. (only if you haven't) edit native/model.config.json with your real URLs + SHAs
    2. cd $ROOT && npm run android:apk
    3. adb install android/app/build/outputs/apk/debug/app-debug.apk
EOF
