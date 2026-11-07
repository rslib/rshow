#!/usr/bin/env bash
# Runs one built rshow single executable through `rshow upgrade`, against a
# release served on 127.0.0.1 from a temp folder, with temp HOME and XDG
# folders, so that nothing on the machine that runs the test can change the
# result and no network other than localhost is touched.
#
# Usage: bash tests/upgrade-binary.test.sh ./rshow-darwin-arm64
# Build the binary first: npm run build && node packages/cli/scripts/sea.mjs
set -uo pipefail

die() {
  printf 'upgrade-binary: %s\n' "$1" >&2
  exit 1
}

if [ "$#" -lt 1 ] || [ -z "${1:-}" ]; then
  printf 'usage: bash tests/upgrade-binary.test.sh <binary>\n' >&2
  exit 2
fi

BIN="$(cd -P "$(dirname "$1")" && pwd -P)/$(basename "$1")"
[ -x "$BIN" ] || die "no such binary: $1"

case "$(uname -s)" in
  Linux) PLATFORM=linux ;;
  Darwin) PLATFORM=darwin ;;
  *) die "this test needs Linux or macOS, not $(uname -s)" ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) ARCH=x64 ;;
  arm64 | aarch64) ARCH=arm64 ;;
  *) die "this test needs x64 or arm64, not $(uname -m)" ;;
esac
TARGET=$PLATFORM-$ARCH
FOLDER=rshow-$TARGET

ROOT=$(mktemp -d "${TMPDIR:-/tmp}/rshow-upgrade-binary.XXXXXX") || die "cannot make a temp dir"
SERVER_PID=""
cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null
    SERVER_PID=""
  fi
  rm -rf "$ROOT"
}
trap cleanup EXIT
trap 'exit 1' INT TERM

# ------------------------------------------------------------- the isolated home ---

export HOME=$ROOT/home
export XDG_DATA_HOME=$ROOT/data
export XDG_CONFIG_HOME=$ROOT/config
export XDG_CACHE_HOME=$ROOT/cache
mkdir -p "$HOME" "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" ||
  die "cannot make the temp folders"
if [ -e "$XDG_CONFIG_HOME/rshow" ] || [ -e "$HOME/.config/rshow" ]; then
  die "the temp folders hold an rshow config"
fi
unset RSHOW_URL RSHOW_ART RSHOW_TOKEN RSHOW_THEME RSHOW_SKILLS_DIR RSHOW_NO_COMPLETIONS 2>/dev/null || true
export RSHOW_SYSTEM_CA=0

VERSION=$("$BIN" --version | awk '{ print $2 }')
contains() {
  case "$1" in
    *"$2"*) return 0 ;;
  esac
  return 1
}
[ -n "$VERSION" ] || die "$BIN --version printed no version"
contains "$VERSION" "." || die "$BIN --version printed [$VERSION], expected a version"

# -------------------------------------------------------------- the release ---

sha256() { # file
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  else
    shasum -a 256 "$1" | awk '{ print $1 }'
  fi
}

RELEASE=$ROOT/release
STAGE=$ROOT/stage
TARBALL=$RELEASE/$FOLDER.tar.gz
mkdir -p "$STAGE/$FOLDER/completions" "$RELEASE" || die "cannot make the release folders"
cp "$BIN" "$STAGE/$FOLDER/rshow" || die "cannot copy $BIN"
chmod 755 "$STAGE/$FOLDER/rshow" || die "cannot make the copy executable"
"$BIN" completion bash >"$STAGE/$FOLDER/completions/rshow.bash" || die "cannot write the bash completion"
"$BIN" completion zsh >"$STAGE/$FOLDER/completions/_rshow" || die "cannot write the zsh completion"
"$BIN" completion fish >"$STAGE/$FOLDER/completions/rshow.fish" || die "cannot write the fish completion"
(cd "$STAGE" && tar -czf "$TARBALL" "$FOLDER") || die "cannot pack $TARBALL"

write_sums() {
  printf '%s  %s.tar.gz\n' "$(sha256 "$TARBALL")" "$FOLDER" >"$RELEASE/SHA256SUMS" ||
    die "cannot write $RELEASE/SHA256SUMS"
}
write_sums

# ----------------------------------------------------------------- the server ---

node -e '
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const root = process.argv[1];
const server = http.createServer((request, response) => {
  const name = path.basename(decodeURIComponent((request.url || "/").split("?")[0]));
  fs.readFile(path.join(root, name), (err, body) => {
    if (err) {
      response.writeHead(404);
      response.end("not found");
      return;
    }
    response.writeHead(200, { "content-length": body.length });
    response.end(body);
  });
});
server.listen(0, "127.0.0.1", () => process.stdout.write(String(server.address().port)));
' "$RELEASE" >"$ROOT/port" 2>"$ROOT/server.log" &
SERVER_PID=$!

WAITED=0
while [ ! -s "$ROOT/port" ]; do
  kill -0 "$SERVER_PID" 2>/dev/null || die "the http server exited: $(cat "$ROOT/server.log")"
  WAITED=$((WAITED + 1))
  [ "$WAITED" -lt 100 ] || die "the http server did not listen within 10s"
  sleep 0.1
done
BASE="http://127.0.0.1:$(cat "$ROOT/port")"
export RSHOW_DOWNLOAD_BASE=$BASE

# ---------------------------------------------------------- the installed copy ---

INSTALL=$ROOT/bin/rshow
LINK=$ROOT/link/rshow
mkdir -p "$ROOT/bin" "$ROOT/link" || die "cannot make the install folders"
cp "$BIN" "$INSTALL" || die "cannot copy $BIN to $INSTALL"
chmod 755 "$INSTALL" || die "cannot make $INSTALL executable"
ln -s "$INSTALL" "$LINK" || die "cannot link $LINK"

# An old completion in one shell, so that the upgrade has one to replace.
FISH=$XDG_CONFIG_HOME/fish/completions/rshow.fish
BASH=$XDG_DATA_HOME/bash-completion/completions/rshow
ZSH=$XDG_DATA_HOME/zsh/site-functions/_rshow
mkdir -p "$(dirname "$FISH")" || die "cannot make $(dirname "$FISH")"
printf '# an old fish completion\n' >"$FISH" || die "cannot write $FISH"

# ------------------------------------------------------------------- helpers ---

TESTS=0
FAILS=0
pass() {
  TESTS=$((TESTS + 1))
  printf 'ok %d - %s\n' "$TESTS" "$1"
}
fail() {
  TESTS=$((TESTS + 1))
  FAILS=$((FAILS + 1))
  printf 'not ok %d - %s\n' "$TESTS" "$1" >&2
  if [ -n "${2:-}" ]; then printf '  # %s\n' "$2" >&2; fi
}

OUT=""
ERR=""
STATUS=0

# run [args...]: runs the binary through its symlink and records OUT, ERR and
# STATUS.
run() {
  : >"$ROOT/out" || die "cannot write $ROOT/out"
  : >"$ROOT/err" || die "cannot write $ROOT/err"
  "$LINK" "$@" >"$ROOT/out" 2>"$ROOT/err"
  STATUS=$?
  OUT=$(cat "$ROOT/out")
  ERR=$(cat "$ROOT/err")
}

check() { # desc cmd...
  local desc=$1
  shift
  if "$@"; then pass "$desc"; else fail "$desc" "command failed: $*"; fi
}

check_eq() { # desc actual expected
  if [ "$2" = "$3" ]; then pass "$1"; else fail "$1" "expected [$3], got [$2]"; fi
}

check_contains() { # desc haystack needle
  if contains "$2" "$3"; then pass "$1"; else fail "$1" "missing [$3] in: [$2]"; fi
}

inode_of() { # file
  ls -i "$1" | awk '{ print $1 }'
}

# ------------------------------------------------------- the running version ---

step() { printf '# %s\n' "$1"; }

step "rshow upgrade, from a mirror that holds the running version"
BEFORE_INODE=$(inode_of "$INSTALL")
run upgrade
check_eq "it exits 0" "$STATUS" "0"
check_contains "it says the file is already at the running version" "$OUT" "already at $VERSION"
check_contains "it names the download on stderr" "$ERR" "rshow: downloading $BASE/$FOLDER.tar.gz"
check_eq "it leaves the installed file alone" "$(inode_of "$INSTALL")" "$BEFORE_INODE"

step "rshow upgrade --json, with nothing to do"
run upgrade --json
check_eq "--json exits 0" "$STATUS" "0"
check_contains "--json says nothing was upgraded" "$OUT" '"upgraded": false'
check_eq "--json keeps the download line off stdout" "$(printf '%s\n' "$OUT" | grep -c downloading)" "0"
check_contains "--json keeps the download line on stderr" "$ERR" "rshow: downloading $BASE/$FOLDER.tar.gz"

# --------------------------------------------------------------- --force ---

step "rshow upgrade --force"
BEFORE_INODE=$(inode_of "$INSTALL")
run upgrade --force
check_eq "--force exits 0" "$STATUS" "0"
check_contains "--force says it upgraded" "$OUT" "upgraded"
check "the installed file is a new one" test "$(inode_of "$INSTALL")" != "$BEFORE_INODE"
check "the symlink is still a symlink" test -L "$LINK"
check_eq "the installed file prints the same version" "$("$INSTALL" --version | awk '{ print $2 }')" "$VERSION"
check_eq "nothing but the binary is left in the install folder" "$(ls -A "$ROOT/bin")" "rshow"
check "the installed file is executable" test -x "$INSTALL"

step "the completions of the tarball"
check_contains "the fish completion was replaced" "$(cat "$FISH")" "complete -c rshow"
check "the bash completion was not created" test ! -e "$BASH"
check "the zsh completion was not created" test ! -e "$ZSH"

# ------------------------------------------------------------ a broken hash ---

step "rshow upgrade --force, from a mirror whose SHA256SUMS is wrong"
BEFORE_INODE=$(inode_of "$INSTALL")
ZERO=0000000000000000000000000000000000000000000000000000000000000000
printf '%s  %s.tar.gz\n' "$ZERO" "$FOLDER" >"$RELEASE/SHA256SUMS" ||
  die "cannot write $RELEASE/SHA256SUMS"
run upgrade --force
check "a broken SHA256SUMS exits non-zero" test "$STATUS" -ne 0
check_contains "it says the checksum differs" "$ERR" "checksum mismatch"
check_eq "the installed file keeps its inode" "$(inode_of "$INSTALL")" "$BEFORE_INODE"
check_eq "the installed file still runs" "$("$INSTALL" --version | awk '{ print $2 }')" "$VERSION"
check_eq "nothing but the binary is left in the install folder" "$(ls -A "$ROOT/bin")" "rshow"
write_sums

# ------------------------------------------------------------------ report ---

if [ "$FAILS" -gt 0 ]; then
  printf 'upgrade-binary: %d of %d checks failed\n' "$FAILS" "$TESTS" >&2
  exit 1
fi
printf 'upgrade-binary: ok (%d checks, rshow %s %s)\n' "$TESTS" "$VERSION" "$TARGET"
