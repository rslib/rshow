#!/usr/bin/env bash
# Runs one built rshow single executable through the commands that touch its
# embedded files, with a temp HOME and cache, so that nothing on the machine that
# runs the test can change the result.
#
# Usage: bash tests/sea-smoke.sh ./rshow-darwin-arm64
# Build the binary first: npm run build && node packages/cli/scripts/sea.mjs
set -uo pipefail

die() {
  printf 'sea-smoke: %s\n' "$1" >&2
  exit 1
}

if [ "$#" -lt 1 ] || [ -z "${1:-}" ]; then
  printf 'usage: bash tests/sea-smoke.sh <binary>\n' >&2
  exit 2
fi

BIN="$(cd -P "$(dirname "$1")" && pwd -P)/$(basename "$1")"
[ -x "$BIN" ] || die "no such binary: $1"

ROOT=$(mktemp -d "${TMPDIR:-/tmp}/rshow-sea-smoke.XXXXXX") || die "cannot make a temp dir"
PREVIEW_PID=""
cleanup() {
  if [ -n "$PREVIEW_PID" ]; then
    kill "$PREVIEW_PID" 2>/dev/null
    wait "$PREVIEW_PID" 2>/dev/null
    PREVIEW_PID=""
  fi
  rm -rf "$ROOT"
}
trap cleanup EXIT
trap 'exit 1' INT TERM

export HOME=$ROOT/home
export XDG_CACHE_HOME=$ROOT/cache
mkdir -p "$HOME/.claude" || die "cannot make $HOME/.claude"
unset RSHOW_URL RSHOW_ART RSHOW_TOKEN RSHOW_SKILLS_DIR RSHOW_THEME XDG_CONFIG_HOME 2>/dev/null || true

OUT=""
ERR=""
STATUS=0

rshow() { # args...
  : >"$ROOT/out" || die "cannot write $ROOT/out"
  : >"$ROOT/err" || die "cannot write $ROOT/err"
  "$BIN" "$@" >"$ROOT/out" 2>"$ROOT/err"
  STATUS=$?
  OUT=$(cat "$ROOT/out")
  ERR=$(cat "$ROOT/err")
}

contains() {
  case "$1" in
    *"$2"*) return 0 ;;
  esac
  return 1
}

step() { printf '# %s\n' "$1"; }

ok() { # expected-status what
  [ "$STATUS" -eq "$1" ] || die "$2 exited $STATUS, expected $1: $ERR"
}

# ------------------------------------------------------------- the basics ---

step "rshow --version"
rshow --version
ok 0 "--version"
contains "$OUT" "rshow " || die "rshow --version printed [$OUT], expected rshow <version>"
contains "$OUT" "(binary)" || die "rshow --version printed [$OUT], expected (binary) after the version"
VERSION_TEXT=$(printf '%s\n' "$OUT" | awk '{ print $2 }')

step "rshow --help"
rshow --help
ok 0 "--help"
contains "$OUT" "usage: rshow" || die "rshow --help printed no usage: $OUT"

step "rshow completion bash"
rshow completion bash
ok 0 "completion bash"
contains "$OUT" "complete -F" || die "rshow completion bash printed no complete -F: $OUT"

step "rshow doctor names the binary"
rshow doctor
contains "$OUT" "(binary)" || die "rshow doctor printed no (binary): $OUT"

step "rshow upgrade --help"
rshow upgrade --help
ok 0 "upgrade --help"
contains "$OUT" "usage: rshow upgrade" || die "rshow upgrade --help printed no usage: $OUT"
contains "$OUT" "--force" || die "rshow upgrade --help printed no --force: $OUT"

# ------------------------------------------------------- the embedded theme ---

step "the assets are unpacked into \$XDG_CACHE_HOME/rshow/$VERSION_TEXT"
CACHE=$XDG_CACHE_HOME/rshow/$VERSION_TEXT
THEME_DIR=$(find "$XDG_CACHE_HOME/rshow" -type d -path '*themes/default' 2>/dev/null | head -n 1)
[ -n "$THEME_DIR" ] || die "no themes/default under $XDG_CACHE_HOME/rshow"
[ -f "$CACHE/.complete" ] || die "no $CACHE/.complete marker"
[ -f "$THEME_DIR/theme.json" ] || die "no theme.json in $THEME_DIR"
[ -d "$CACHE/skills" ] || die "no skills folder in $CACHE"

step "rshow check $THEME_DIR --offline"
rshow check "$THEME_DIR" --offline
ok 0 "check"
contains "$OUT" "check: ok" || die "rshow check printed [$OUT]"

step "rshow theme new demo --dir $ROOT/themes"
rshow theme new demo --dir "$ROOT/themes"
ok 0 "theme new"
[ -f "$ROOT/themes/demo/theme.json" ] || die "rshow theme new wrote no $ROOT/themes/demo/theme.json"

step "rshow theme check $ROOT/themes/demo"
rshow theme check "$ROOT/themes/demo"
ok 0 "theme check"
contains "$OUT" "check: ok" || die "rshow theme check printed [$OUT]"

# -------------------------------------------------------------- the config ---

step "rshow init --url https://artd.example.com --art https://art.example.com"
rshow init --url https://artd.example.com --art https://art.example.com
ok 0 "init"
[ -f "$HOME/.config/rshow/config.json" ] || die "rshow init wrote no $HOME/.config/rshow/config.json"
contains "$OUT" "next: rshow login" || die "rshow init printed [$OUT]"

step "rshow config --offline"
rshow config --offline
ok 0 "config"
contains "$OUT" '"url": "https://artd.example.com"' || die "rshow config printed no url: $OUT"
contains "$OUT" '"art": "https://art.example.com"' || die "rshow config printed no art: $OUT"

# -------------------------------------------------------------- the skills ---

step "rshow skills install --copy"
rshow skills install --copy
ok 0 "skills install"
contains "$OUT" "installed 3 skills for claude" || die "rshow skills install printed [$OUT]: $ERR"
[ -f "$HOME/.claude/skills/rshow/SKILL.md" ] || die "rshow skills install wrote no $HOME/.claude/skills/rshow/SKILL.md"
[ -f "$HOME/.claude/skills/rshow/.rshow-skill" ] || die "the copy carries no .rshow-skill marker"

step "rshow skills status"
rshow skills status
ok 0 "skills status"
contains "$OUT" "copy v$VERSION_TEXT" || die "rshow skills status printed [$OUT]"

# ------------------------------------------------------------- the preview ---

SITE=$ROOT/site
mkdir -p "$SITE" || die "cannot make $SITE"
printf '<!doctype html><title>sea smoke</title><p>sea smoke\n' >"$SITE/index.html" || die "cannot write $SITE/index.html"

step "rshow preview $SITE --offline"
"$BIN" preview "$SITE" --offline --port 0 >"$ROOT/preview.log" 2>&1 &
PREVIEW_PID=$!

BASE=""
WAITED=0
while [ -z "$BASE" ]; do
  BASE=$(head -n 1 "$ROOT/preview.log" 2>/dev/null || true)
  case "$BASE" in
    http://*) ;;
    "")
      if ! kill -0 "$PREVIEW_PID" 2>/dev/null; then
        PREVIEW_PID=""
        die "preview exited before listening: $(cat "$ROOT/preview.log")"
      fi
      WAITED=$((WAITED + 1))
      [ "$WAITED" -lt 100 ] || die "preview did not answer within 10s: $(cat "$ROOT/preview.log")"
      sleep 0.1
      ;;
    *) die "preview printed [$BASE], expected a url" ;;
  esac
done

step "GET $BASE/_themes/default@1/tokens.css"
CODE=$(curl -sS -o "$ROOT/tokens.css" -w '%{http_code}' "$BASE/_themes/default@1/tokens.css") ||
  die "curl could not GET $BASE/_themes/default@1/tokens.css"
[ "$CODE" = "200" ] || die "GET /_themes/default@1/tokens.css returned $CODE, expected 200"
grep -q -- '--bg' "$ROOT/tokens.css" || die "the served tokens.css holds no --bg"

step "stop the preview"
kill "$PREVIEW_PID" 2>/dev/null
wait "$PREVIEW_PID" 2>/dev/null
PREVIEW_PID=""

printf 'sea-smoke: ok (%s)\n' "$VERSION_TEXT"
