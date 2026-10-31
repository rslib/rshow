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
VERSION=0.0.5

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

# A stub rshow that answers --version like the real one.
stub() { # file
  cat >"$1" <<EOF
#!/bin/sh
case "\${1:-}" in
  --version) printf 'rshow $VERSION (binary)\n' ;;
  *) printf 'stub\n' ;;
esac
EOF
  chmod 755 "$1"
}

# A release folder holding rshow-<target>.tar.gz per target, each with the stub
# binary and the three completion files, and its SHA256SUMS.
RELEASE=$ROOT/release
STAGE=$ROOT/stage
mkdir -p "$RELEASE" || exit 1
for target in $TARGETS; do
  rm -rf "$STAGE"
  mkdir -p "$STAGE/rshow-$target/completions" || exit 1
  stub "$STAGE/rshow-$target/rshow"
  printf '# bash completion\n' >"$STAGE/rshow-$target/completions/rshow.bash"
  printf '#compdef rshow\n' >"$STAGE/rshow-$target/completions/_rshow"
  printf '# fish completion\n' >"$STAGE/rshow-$target/completions/rshow.fish"
  (cd "$STAGE" && tar -czf "$RELEASE/rshow-$target.tar.gz" "rshow-$target") || exit 1
done

write_sums() { # folder prefix
  : >"$1/SHA256SUMS"
  for target in $TARGETS; do
    printf '%s  rshow-%s%s\n' "$(sha256 "$1/rshow-$target$2")" "$target" "$2" >>"$1/SHA256SUMS"
  done
}
write_sums "$RELEASE" ".tar.gz"

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
  env -u RSHOW_VERSION -u RSHOW_INSTALL_DIR -u RSHOW_DOWNLOAD_BASE -u RSHOW_NO_COMPLETIONS \
    -u XDG_DATA_HOME -u XDG_CONFIG_HOME HOME="$home" "$@" \
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
  "$("$HOME1/.local/bin/rshow" --version)" "rshow $VERSION (binary)"
check_contains "the run names the installed version" "$OUT" "rshow $VERSION"
check_contains "the run points at rshow init" "$OUT" "rshow init --url"
check_contains "the run points at rshow login" "$OUT" "rshow login"
check_contains "the run points at rshow skills install" "$OUT" "rshow skills install"
check_contains "the run hints at PATH" "$OUT" "not in PATH"
check_eq "nothing goes to stderr" "$ERR" ""

check "the bash completion lands" test -f "$HOME1/.local/share/bash-completion/completions/rshow"
check "the zsh completion lands" test -f "$HOME1/.local/share/zsh/site-functions/_rshow"
check "the fish completion lands" test -f "$HOME1/.config/fish/completions/rshow.fish"
check_eq "the bash completion is the one in the tarball" \
  "$(cat "$HOME1/.local/share/bash-completion/completions/rshow")" "# bash completion"
check_contains "the run names the bash completion" "$OUT" "bash-completion/completions/rshow"
check "nothing but the binary lands in the install folder" test ! -e "$HOME1/.local/bin/completions"

# --------------------------------------------------------------- the XDG ---

HOME2=$(new_home)
run "$HOME2" RSHOW_DOWNLOAD_BASE="file://$RELEASE" \
  XDG_DATA_HOME="$HOME2/data" XDG_CONFIG_HOME="$HOME2/config"
check_eq "XDG: the installer exits 0" "$STATUS" "0"
check "XDG: the bash completion lands under XDG_DATA_HOME" \
  test -f "$HOME2/data/bash-completion/completions/rshow"
check "XDG: the zsh completion lands under XDG_DATA_HOME" \
  test -f "$HOME2/data/zsh/site-functions/_rshow"
check "XDG: the fish completion lands under XDG_CONFIG_HOME" \
  test -f "$HOME2/config/fish/completions/rshow.fish"
check "XDG: nothing lands in \$HOME/.local/share" test ! -e "$HOME2/.local/share/bash-completion"

# ------------------------------------------------------- no completions ---

HOME3=$(new_home)
run "$HOME3" RSHOW_DOWNLOAD_BASE="file://$RELEASE" RSHOW_NO_COMPLETIONS=1
check_eq "RSHOW_NO_COMPLETIONS=1: the installer exits 0" "$STATUS" "0"
check "RSHOW_NO_COMPLETIONS=1: rshow is installed" test -x "$HOME3/.local/bin/rshow"
check "RSHOW_NO_COMPLETIONS=1: no bash completion" \
  test ! -e "$HOME3/.local/share/bash-completion/completions/rshow"
check "RSHOW_NO_COMPLETIONS=1: no zsh completion" \
  test ! -e "$HOME3/.local/share/zsh/site-functions/_rshow"
check "RSHOW_NO_COMPLETIONS=1: no fish completion" \
  test ! -e "$HOME3/.config/fish/completions/rshow.fish"
check "RSHOW_NO_COMPLETIONS=1: it says nothing about completions" \
  test -z "$(printf '%s\n' "$OUT" | grep completion)"

# ------------------------------------------------------------- a bad hash ---

HOME4=$(new_home)
ZERO=0000000000000000000000000000000000000000000000000000000000000000
printf '%s\n' "$ZERO  rshow-linux-x64.tar.gz" "$ZERO  rshow-linux-arm64.tar.gz" \
  "$ZERO  rshow-darwin-arm64.tar.gz" >"$RELEASE/SHA256SUMS"
run "$HOME4" RSHOW_DOWNLOAD_BASE="file://$RELEASE"
[ "$STATUS" -ne 0 ] && pass "a bad hash exits non-zero" || fail "a bad hash exits non-zero" "exited $STATUS: $OUT"
check_contains "it says the checksum differs" "$ERR" "checksum mismatch"
check "it installs nothing" test ! -e "$HOME4/.local/bin/rshow"
check "it installs no completion" test ! -e "$HOME4/.local/share/bash-completion/completions/rshow"
write_sums "$RELEASE" ".tar.gz"

# ------------------------------------------------------- the install folder ---

HOME5=$(new_home)
BIN5=$ROOT/bin5
run "$HOME5" RSHOW_DOWNLOAD_BASE="file://$RELEASE" RSHOW_INSTALL_DIR="$BIN5"
check_eq "RSHOW_INSTALL_DIR: the installer exits 0" "$STATUS" "0"
check "RSHOW_INSTALL_DIR: rshow lands there" test -x "$BIN5/rshow"
check "RSHOW_INSTALL_DIR: nothing lands in \$HOME/.local/bin" test ! -e "$HOME5/.local/bin/rshow"

HOME6=$(new_home)
run "$HOME6" RSHOW_DOWNLOAD_BASE="file://$RELEASE" RSHOW_INSTALL_DIR="$BIN5" RSHOW_VERSION="v$VERSION"
check_eq "RSHOW_DOWNLOAD_BASE wins over RSHOW_VERSION: the installer exits 0" "$STATUS" "0"
check "RSHOW_DOWNLOAD_BASE wins over RSHOW_VERSION: rshow is installed" test -x "$BIN5/rshow"

# -------------------------------------------------- a release as it was ---

# 0.0.2 to 0.0.5 held the plain binary and no tarball: that still installs.
OLD=$ROOT/release-old
mkdir -p "$OLD" || exit 1
for target in $TARGETS; do
  stub "$OLD/rshow-$target"
done
write_sums "$OLD" ""

HOME7=$(new_home)
run "$HOME7" RSHOW_DOWNLOAD_BASE="file://$OLD"
check_eq "old layout: the installer exits 0" "$STATUS" "0"
check "old layout: rshow lands in \$HOME/.local/bin" test -x "$HOME7/.local/bin/rshow"
check_contains "old layout: the run says it falls back" "$OUT" "installing the plain binary"
check_eq "old layout: the installed version is printed" \
  "$("$HOME7/.local/bin/rshow" --version)" "rshow $VERSION (binary)"
check "old layout: no completion is installed" \
  test ! -e "$HOME7/.local/share/bash-completion/completions/rshow"
check_eq "old layout: nothing goes to stderr" "$ERR" ""

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

HOME8=$(new_home)
run "$HOME8" PATH="$FAKE:$PATH" RSHOW_DOWNLOAD_BASE="file://$RELEASE"
[ "$STATUS" -eq 1 ] && pass "an unknown platform exits 1" || fail "an unknown platform exits 1" "exited $STATUS: $OUT"
check_contains "it names the npm fallback" "$ERR" "npm i -g rshow"
check "an unknown platform installs nothing" test ! -e "$HOME8/.local/bin/rshow"

# ------------------------------------------------------------------ report ---

if [ "$FAILS" -gt 0 ]; then
  printf 'curl-install: %d of %d checks failed\n' "$FAILS" "$TESTS" >&2
  exit 1
fi
printf 'curl-install: ok (%d checks)\n' "$TESTS"
