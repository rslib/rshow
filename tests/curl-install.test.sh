#!/usr/bin/env bash
# Tests for site/public/install.sh, the curl installer the docs site serves.
# Run: bash tests/curl-install.test.sh
#
# The releases are served from a local folder over file://, which curl supports,
# so the test needs no network and no GitHub.
set -uo pipefail

REPO=$(cd -P "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd -P)
INSTALL=$REPO/site/public/install.sh
TARGETS="linux-x64 linux-arm64 darwin-arm64"
VERSION=0.0.2

TESTS=0
FAILS=0
ROOT=$(mktemp -d "${TMPDIR:-/tmp}/rshow-curl-install-test.XXXXXX")
trap 'rm -rf "$ROOT"' EXIT

pass() { TESTS=$((TESTS + 1)); printf 'ok %d - %s\n' "$TESTS" "$1"; }
fail() {
  TESTS=$((TESTS + 1))
  FAILS=$((FAILS + 1))
  printf 'not ok %d - %s\n' "$TESTS" "$1" >&2
  if [ -n "${2:-}" ]; then printf '  # %s\n' "$2" >&2; fi
}

contains() {
  case "$1" in
    *"$2"*) return 0 ;;
  esac
  return 1
}

sha256() { # file
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  else
    shasum -a 256 "$1" | awk '{ print $1 }'
  fi
}

# A release folder with a stub rshow for every target and its SHA256SUMS.
RELEASE=$ROOT/release
mkdir -p "$RELEASE" || exit 1
for target in $TARGETS; do
  cat >"$RELEASE/rshow-$target" <<EOF
#!/bin/sh
case "\${1:-}" in
  --version) printf 'rshow $VERSION\n' ;;
  *) printf 'stub\n' ;;
esac
EOF
  chmod 755 "$RELEASE/rshow-$target"
done
write_sums() {
  : >"$RELEASE/SHA256SUMS"
  for target in $TARGETS; do
    printf '%s  rshow-%s\n' "$(sha256 "$RELEASE/rshow-$target")" "$target" >>"$RELEASE/SHA256SUMS"
  done
}
write_sums

OUT=""
ERR=""
STATUS=0

# run <home> [VAR=value ...]: runs the installer with that home and those
# variables, and records OUT, ERR and STATUS.
run() {
  local home=$1
  shift
  local outf errf
  outf=$(mktemp "$ROOT/out.XXXXXX")
  errf=$(mktemp "$ROOT/err.XXXXXX")
  env -u RSHOW_VERSION -u RSHOW_INSTALL_DIR -u RSHOW_DOWNLOAD_BASE HOME="$home" "$@" \
    sh "$INSTALL" >"$outf" 2>"$errf"
  STATUS=$?
  OUT=$(cat "$outf")
  ERR=$(cat "$errf")
  rm -f "$outf" "$errf"
}

new_home() {
  mktemp -d "$ROOT/home.XXXXXX"
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

# ------------------------------------------------------------- the success ---

HOME1=$(new_home)
run "$HOME1" RSHOW_DOWNLOAD_BASE="file://$RELEASE"
check_eq "the installer exits 0" "$STATUS" "0"
check "rshow lands in \$HOME/.local/bin" test -f "$HOME1/.local/bin/rshow"
check "it is executable" test -x "$HOME1/.local/bin/rshow"
check_eq "the installed version is printed" \
  "$("$HOME1/.local/bin/rshow" --version)" "rshow $VERSION"
check_contains "the run names the installed version" "$OUT" "rshow $VERSION"
check_contains "the run points at rshow init" "$OUT" "rshow init --url"
check_contains "the run points at rshow skills install" "$OUT" "rshow skills install"
check_contains "the run hints at PATH" "$OUT" "not in PATH"
check_eq "nothing goes to stderr" "$ERR" ""

# ------------------------------------------------------------- a bad hash ---

HOME2=$(new_home)
printf '%s\n' "0000000000000000000000000000000000000000000000000000000000000000  rshow-linux-x64" \
  "0000000000000000000000000000000000000000000000000000000000000000  rshow-linux-arm64" \
  "0000000000000000000000000000000000000000000000000000000000000000  rshow-darwin-arm64" >"$RELEASE/SHA256SUMS"
run "$HOME2" RSHOW_DOWNLOAD_BASE="file://$RELEASE"
[ "$STATUS" -ne 0 ] && pass "a bad hash exits non-zero" || fail "a bad hash exits non-zero" "exited $STATUS: $OUT"
check_contains "it says the checksum differs" "$ERR" "checksum mismatch"
check "it installs nothing" test ! -e "$HOME2/.local/bin/rshow"
write_sums

# ------------------------------------------------------ the install folder ---

HOME3=$(new_home)
BIN3=$ROOT/bin3
run "$HOME3" RSHOW_DOWNLOAD_BASE="file://$RELEASE" RSHOW_INSTALL_DIR="$BIN3"
check_eq "RSHOW_INSTALL_DIR: the installer exits 0" "$STATUS" "0"
check "RSHOW_INSTALL_DIR: rshow lands there" test -x "$BIN3/rshow"
check "RSHOW_INSTALL_DIR: nothing lands in \$HOME/.local/bin" test ! -e "$HOME3/.local/bin/rshow"

HOME4=$(new_home)
run "$HOME4" RSHOW_DOWNLOAD_BASE="file://$RELEASE" RSHOW_INSTALL_DIR="$BIN3" RSHOW_VERSION="v$VERSION"
check_eq "RSHOW_DOWNLOAD_BASE wins over RSHOW_VERSION: the installer exits 0" "$STATUS" "0"
check "RSHOW_DOWNLOAD_BASE wins over RSHOW_VERSION: rshow is installed" test -x "$BIN3/rshow"

# --------------------------------------------------------- another platform ---

# A fake uname first on PATH says this is a machine rshow has no binary for.
FAKE=$ROOT/fakebin
mkdir -p "$FAKE"
cat >"$FAKE/uname" <<'EOF'
#!/bin/sh
case "${1:-}" in
  -s) printf 'Linux\n' ;;
  -m) printf 'i686\n' ;;
  *) printf 'Linux\n' ;;
esac
EOF
chmod 755 "$FAKE/uname"

HOME5=$(new_home)
run "$HOME5" PATH="$FAKE:$PATH" RSHOW_DOWNLOAD_BASE="file://$RELEASE"
[ "$STATUS" -eq 1 ] && pass "an unknown platform exits 1" || fail "an unknown platform exits 1" "exited $STATUS: $OUT"
check_contains "it names the npm fallback" "$ERR" "npm i -g rshow"
check "an unknown platform installs nothing" test ! -e "$HOME5/.local/bin/rshow"

# ------------------------------------------------------------------ report ---

if [ "$FAILS" -gt 0 ]; then
  printf 'curl-install: %d of %d checks failed\n' "$FAILS" "$TESTS" >&2
  exit 1
fi
printf 'curl-install: ok (%d checks)\n' "$TESTS"
