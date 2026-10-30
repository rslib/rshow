#!/usr/bin/env bash
# Runs the packed rshow package on one node binary, the way a user does after
# `npm install -g rshow`: unpack the tarball, then only that node runs the CLI.
# Usage: bash tests/compat.sh /path/to/node    (run npm run build first)
set -uo pipefail

REPO=$(cd -P "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd -P)

die() {
  printf 'compat: %s\n' "$1" >&2
  exit 1
}

if [ "$#" -lt 1 ] || [ -z "${1:-}" ]; then
  printf 'usage: bash tests/compat.sh <node-binary>\n' >&2
  exit 2
fi

NODE=$1
[ -x "$NODE" ] || die "no such node binary: $NODE"
[ -f "$REPO/packages/cli/dist/main.js" ] || die "missing packages/cli/dist/main.js; run npm run build first"

NODE_VERSION=$("$NODE" -v) || die "$NODE does not run"
printf '# node %s from %s\n' "$NODE_VERSION" "$NODE"

ROOT=$(mktemp -d "${TMPDIR:-/tmp}/rshow-compat.XXXXXX") || die "cannot make a temp dir"
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

# A temp HOME keeps the real config, and so the real tokens, out of the run.
HOME=$ROOT/home
mkdir -p "$HOME" || die "cannot make $HOME"
export HOME
unset XDG_CONFIG_HOME RSHOW_URL RSHOW_ART RSHOW_TOKEN 2>/dev/null

# ------------------------------------------------------------- the package ---

step() { printf '# %s\n' "$1"; }

step "pack and unpack the tarball"
PACK_LOG=$ROOT/pack.log
(cd "$REPO/packages/cli" && npm pack --pack-destination "$ROOT") >"$PACK_LOG" 2>&1 ||
  die "npm pack failed: $(cat "$PACK_LOG")"
TARBALL=$(ls "$ROOT"/rshow-*.tgz 2>/dev/null | head -n 1)
[ -n "$TARBALL" ] || die "npm pack wrote no tarball: $(cat "$PACK_LOG")"
mkdir "$ROOT/pkg" || die "cannot make $ROOT/pkg"
tar -xzf "$TARBALL" -C "$ROOT/pkg" || die "cannot unpack $TARBALL"
CLI=$ROOT/pkg/package/dist/main.js
[ -f "$CLI" ] || die "the tarball has no dist/main.js"
# The tarball must stand alone: no installed tree, no workspace links.
[ ! -e "$ROOT/pkg/package/node_modules" ] || die "the packed package ships node_modules"

# ----------------------------------------------------------------- helpers ---

OUT=""
ERR=""
STATUS=0

rshow() { # args...
  : >"$ROOT/out" || die "cannot write $ROOT/out"
  : >"$ROOT/err" || die "cannot write $ROOT/err"
  "$NODE" "$CLI" "$@" >"$ROOT/out" 2>"$ROOT/err"
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

ok() { # command...
  [ "$STATUS" -eq "$1" ] || die "rshow $2 exited $STATUS, expected $1: $ERR"
}

WORK=$ROOT/work
mkdir -p "$WORK" || die "cannot make $WORK"

# ------------------------------------------------------------- the commands ---

step "rshow --version"
rshow --version
ok 0 "--version"
contains "$OUT" "rshow " || die "rshow --version printed [$OUT], expected rshow <version>"
VERSION_TEXT=$OUT

step "rshow --help"
rshow --help
ok 0 "--help"
contains "$OUT" "usage: rshow" || die "rshow --help printed no usage: $OUT"
HELP=$OUT

# help_of prints the help of one command or subcommand and fails on anything
# but exit 0 and a usage line.
help_of() { # words...
  step "rshow $* --help"
  rshow "$@" --help
  ok 0 "$* --help"
  contains "$OUT" "usage: rshow" || die "rshow $* --help printed no usage: $OUT"
}

# subcommands_of reads a usage line like "usage: rshow theme <new|check>" and
# prints its alternatives; a plain placeholder such as "<dir>" names none.
subcommands_of() { # usage-line
  contains "$1" "<" || return 0
  INNER=${1#*<}
  INNER=${INNER%%>*}
  contains "$INNER" "|" || return 0
  printf '%s\n' "$INNER" | tr '|' ' '
}

# Every command the help lists, and the ones it hides, must answer --help.
# "theme new" and its siblings all start with "theme", so keep the first word
# of each line once.
COMMANDS=$(printf '%s\n' "$HELP" | awk '
  /^commands:/ { found = 1; next }
  found && /^$/ { found = 0 }
  found && !seen[$1]++ { print $1 }
')
[ -n "$COMMANDS" ] || die "rshow --help lists no commands"
for name in $COMMANDS docs; do
  help_of "$name"
  for sub in $(subcommands_of "${OUT%%$'\n'*}"); do
    case "$sub" in
      *[a-z]*) help_of "$name" "$sub" ;;
    esac
  done
done

step "rshow check themes/default --offline"
rshow check "$REPO/themes/default" --offline
ok 0 "check"
contains "$OUT" "check: ok" || die "rshow check themes/default printed [$OUT]"

step "rshow theme new demo --dir $WORK"
rshow theme new demo --dir "$WORK"
ok 0 "theme new"
[ -f "$WORK/demo/theme.json" ] || die "rshow theme new wrote no $WORK/demo/theme.json"

step "rshow theme check $WORK/demo"
rshow theme check "$WORK/demo"
ok 0 "theme check"
contains "$OUT" "check: ok" || die "rshow theme check printed [$OUT]"

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

step "rshow docs --out $ROOT/ref"
rshow docs --out "$ROOT/ref"
ok 0 "docs"
[ -f "$ROOT/ref/commands/index.md" ] || die "rshow docs wrote no commands/index.md"
[ -f "$ROOT/ref/theme-tokens.md" ] || die "rshow docs wrote no theme-tokens.md"

# ------------------------------------------------------------- the preview ---

PORT=$("$NODE" --input-type=module -e '
import net from "node:net";
const server = net.createServer();
server.listen(0, "127.0.0.1", () => {
  process.stdout.write(String(server.address().port));
  server.close();
});
') || die "cannot find a free port"
case "$PORT" in
  [0-9]*) ;;
  *) die "free port lookup printed [$PORT]" ;;
esac

SITE=$ROOT/site
mkdir -p "$SITE" || die "cannot make $SITE"
printf '<!doctype html><title>compat</title><p>compat\n' >"$SITE/index.html" || die "cannot write $SITE/index.html"

step "rshow preview $SITE --offline --port $PORT"
"$NODE" "$CLI" preview "$SITE" --offline --port "$PORT" >"$ROOT/preview.log" 2>&1 &
PREVIEW_PID=$!
BASE=http://127.0.0.1:$PORT
WAITED=0
while ! curl -fsS -o /dev/null "$BASE/_themes/default@1/tokens.css" 2>/dev/null; do
  if ! kill -0 "$PREVIEW_PID" 2>/dev/null; then
    PREVIEW_PID=""
    die "preview exited before listening: $(cat "$ROOT/preview.log")"
  fi
  WAITED=$((WAITED + 1))
  [ "$WAITED" -lt 100 ] || die "preview did not answer on $BASE within 10s: $(cat "$ROOT/preview.log")"
  sleep 0.1
done

step "GET /_themes/default@1/tokens.css"
CODE=$(curl -sS -o "$ROOT/tokens.css" -D "$ROOT/tokens.hdr" -w '%{http_code}' "$BASE/_themes/default@1/tokens.css") ||
  die "curl could not GET $BASE/_themes/default@1/tokens.css"
[ "$CODE" = "200" ] || die "GET /_themes/default@1/tokens.css returned $CODE, expected 200"
grep -qi 'x-rshow-source: *local' "$ROOT/tokens.hdr" ||
  die "GET /_themes/default@1/tokens.css has no x-rshow-source: local header"

step "PUT and GET /x/_data/k"
CODE=$(curl -sS -X PUT -H 'content-type: application/json' --data '{"value":"compat"}' \
  -o "$ROOT/put.json" -w '%{http_code}' "$BASE/x/_data/k") || die "curl could not PUT $BASE/x/_data/k"
[ "$CODE" = "200" ] || die "PUT /x/_data/k returned $CODE, expected 200: $(cat "$ROOT/put.json")"
CODE=$(curl -sS -o "$ROOT/get.json" -w '%{http_code}' "$BASE/x/_data/k") || die "curl could not GET $BASE/x/_data/k"
[ "$CODE" = "200" ] || die "GET /x/_data/k returned $CODE, expected 200: $(cat "$ROOT/get.json")"
contains "$(cat "$ROOT/get.json")" "compat" || die "GET /x/_data/k did not return the value that was PUT: $(cat "$ROOT/get.json")"

step "stop the preview"
kill "$PREVIEW_PID" 2>/dev/null
wait "$PREVIEW_PID" 2>/dev/null
PREVIEW_PID=""

printf 'compat: ok on node %s (%s)\n' "$NODE_VERSION" "$VERSION_TEXT"
