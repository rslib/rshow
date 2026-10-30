#!/usr/bin/env bash
# Tests for install.sh. Run: bash tests/install.test.sh
set -uo pipefail

REPO=$(cd -P "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd -P)
INSTALL=$REPO/install.sh
SKILLS="rshow rshow-slides rshow-implement"

TESTS=0
FAILS=0
# new_home runs in a $(...) subshell, so each home lives under one root that
# the main shell removes on exit.
ROOT=$(mktemp -d "${TMPDIR:-/tmp}/rshow-install-test.XXXXXX")
trap 'rm -rf "$ROOT"' EXIT

new_home() {
  mktemp -d "$ROOT/home.XXXXXX"
}

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

check() { # desc cmd...
  local desc=$1
  shift
  if "$@"; then pass "$desc"; else fail "$desc" "command failed: $*"; fi
}

check_eq() { # desc actual expected
  if [ "$2" = "$3" ]; then pass "$1"; else fail "$1" "expected [$3], got [$2]"; fi
}

check_contains() { # desc haystack needle
  if contains "$2" "$3"; then pass "$1"; else fail "$1" "missing [$3] in: $2"; fi
}

check_missing() { # desc haystack needle
  if contains "$2" "$3"; then fail "$1" "unexpected [$3] in: $2"; else pass "$1"; fi
}

OUT=""
ERR=""
STATUS=0

run() { # home args...
  local h=$1 outf errf
  shift
  outf=$(mktemp "${TMPDIR:-/tmp}/rshow-install-out.XXXXXX")
  errf=$(mktemp "${TMPDIR:-/tmp}/rshow-install-err.XXXXXX")
  HOME=$h bash "$INSTALL" "$@" >"$outf" 2>"$errf"
  STATUS=$?
  OUT=$(cat "$outf")
  ERR=$(cat "$errf")
  rm -f "$outf" "$errf"
}

snapshot() { # dir
  if stat --version >/dev/null 2>&1; then
    find "$1" -mindepth 1 -exec stat -c '%n|%i|%y|%F' {} + | sort
  else
    find "$1" -mindepth 1 -exec stat -f '%N|%i|%Sm|%HT' {} + | sort
  fi
}

line_for() { # target name, reads $OUT
  printf '%s\n' "$OUT" | grep "^$1 " || true
}

printf '# install.sh\n'

# --- install into claude and pi ---------------------------------------------
H=$(new_home)
mkdir -p "$H/.claude" "$H/.pi/agent"
run "$H"
check_eq "install with no targets exits 0" "$STATUS" 0
check "claude skills dir created" test -d "$H/.claude/skills"
check "pi skills dir created" test -d "$H/.pi/agent/skills"
check "undetected codex untouched" test ! -e "$H/.codex"
for s in $SKILLS; do
  check_eq "claude/$s links to repo" "$(readlink "$H/.claude/skills/$s")" "$REPO/skills/$s"
  check_eq "pi/$s links to repo" "$(readlink "$H/.pi/agent/skills/$s")" "$REPO/skills/$s"
done
check_eq "cli link targets main.ts" "$(readlink "$H/.local/bin/rshow")" "$REPO/packages/cli/src/main.ts"

# --- detection / --list -----------------------------------------------------
run "$H" --list
check_eq "--list exits 0" "$STATUS" 0
check_contains "--list marks claude detected" "$(line_for claude)" "detected"
check_eq "--list marks codex not detected" "$(line_for codex)" "codex  $H/.codex/skills  not detected"
check_contains "--list shows pi dir" "$(line_for pi)" "$H/.pi/agent/skills"

H=$(new_home)
mkdir -p "$H/.codex"
run "$H" --list
check_contains "--list sees codex alone" "$(line_for codex)" "detected"
check_contains "--list sees claude missing" "$(line_for claude)" "not detected"
run "$H"
check "detected target only: codex linked" test -L "$H/.codex/skills/rshow"
check "detected target only: claude untouched" test ! -e "$H/.claude"

# --- symlink into repo to another path is replaced --------------------------
H=$(new_home)
mkdir -p "$H/.claude/skills"
ln -s "$REPO/skills/rshow-implement" "$H/.claude/skills/rshow"
run "$H" claude
check_eq "repo link to another path: exit 0" "$STATUS" 0
check_contains "repo link to another path relinked" "$OUT" "linked $H/.claude/skills/rshow"
check_eq "relinked to right target" "$(readlink "$H/.claude/skills/rshow")" "$REPO/skills/rshow"

# --- re-run is idempotent ---------------------------------------------------
H=$(new_home)
mkdir -p "$H/.claude" "$H/.pi/agent"
run "$H"
before=$(snapshot "$H")
run "$H"
check_eq "re-run exits 0" "$STATUS" 0
check_contains "re-run prints ok" "$OUT" "ok $H/.claude/skills/rshow"
check_missing "re-run prints no linked" "$OUT" "linked "
check_missing "re-run prints no removed" "$OUT" "removed "
check_eq "re-run changed nothing" "$(snapshot "$H")" "$before"

# --- absolute links work from any cwd ---------------------------------------
H=$(new_home)
mkdir -p "$H/.claude"
(cd / && HOME=$H bash "$INSTALL" claude >/dev/null 2>&1)
check_eq "links resolved from foreign cwd" "$(readlink "$H/.claude/skills/rshow")" "$REPO/skills/rshow"

# --- foreign real dir is skipped, exit 1, left intact -----------------------
H=$(new_home)
mkdir -p "$H/.claude/skills/rshow"
printf 'mine\n' >"$H/.claude/skills/rshow/SKILL.md"
run "$H" claude
check_eq "foreign dir: exit 1" "$STATUS" 1
check_contains "foreign dir: skip on stderr" "$ERR" "skip $H/.claude/skills/rshow: exists and is not from this repo"
check "foreign dir left as dir" test -d "$H/.claude/skills/rshow"
check "foreign dir not a symlink" test ! -L "$H/.claude/skills/rshow"
check_eq "foreign dir content intact" "$(cat "$H/.claude/skills/rshow/SKILL.md")" "mine"
check "other skills still linked" test -L "$H/.claude/skills/rshow-slides"

H=$(new_home)
mkdir -p "$H/.claude/skills" "$H/elsewhere"
ln -s "$H/elsewhere" "$H/.claude/skills/rshow"
run "$H" claude
check_eq "foreign symlink: exit 1" "$STATUS" 1
check_contains "foreign symlink: skip on stderr" "$ERR" "skip $H/.claude/skills/rshow"
check_eq "foreign symlink intact" "$(readlink "$H/.claude/skills/rshow")" "$H/elsewhere"

# --- dangling link into repo is removed -------------------------------------
H=$(new_home)
mkdir -p "$H/.pi/agent/skills"
ln -s "$REPO/skills/gone" "$H/.pi/agent/skills/gone"
ln -s "$H/outside" "$H/.pi/agent/skills/outside"
run "$H" pi
check_eq "stale link: exit 0" "$STATUS" 0
check_contains "stale repo link removed" "$OUT" "removed $H/.pi/agent/skills/gone"
check "stale repo link gone" test ! -L "$H/.pi/agent/skills/gone"
check_contains "stale repo link message" "$OUT" "removed "
check "foreign dangling link kept" test -L "$H/.pi/agent/skills/outside"

# --- --dry-run changes nothing ----------------------------------------------
H=$(new_home)
mkdir -p "$H/.claude"
before=$(snapshot "$H")
run "$H" --dry-run
check_eq "dry-run exits 0" "$STATUS" 0
check_contains "dry-run says would linked" "$OUT" "would linked $H/.claude/skills/rshow"
check_contains "dry-run says would linked cli" "$OUT" "would linked $H/.local/bin/rshow"
check "dry-run created no skills dir" test ! -e "$H/.claude/skills"
check "dry-run created no bin dir" test ! -e "$H/.local/bin"
check_eq "dry-run touched nothing" "$(snapshot "$H")" "$before"

H=$(new_home)
mkdir -p "$H/.claude"
run "$H" claude
before=$(snapshot "$H")
mkdir -p "$H/.claude/skills"
ln -s "$REPO/skills/gone" "$H/.claude/skills/gone"
before=$(snapshot "$H")
run "$H" --dry-run claude
check_contains "dry-run removal is would" "$OUT" "would removed $H/.claude/skills/gone"
check "dry-run kept stale link" test -L "$H/.claude/skills/gone"
run "$H" --dry-run --uninstall claude
check_contains "dry-run uninstall is would" "$OUT" "would removed $H/.claude/skills/rshow"
check "dry-run uninstall kept links" test -L "$H/.claude/skills/rshow"

# --- --uninstall removes only our links -------------------------------------
H=$(new_home)
mkdir -p "$H/.claude" "$H/.pi/agent"
run "$H"
mkdir -p "$H/.claude/skills" "$H/.pi/agent/skills" "$H/mine"
ln -s "$H/mine" "$H/.claude/skills/foreign"
printf 'note\n' >"$H/.pi/agent/skills/note.md"
run "$H" --uninstall
check_eq "uninstall exits 0" "$STATUS" 0
check_contains "uninstall reports claude link" "$OUT" "removed $H/.claude/skills/rshow"
for s in $SKILLS; do
  check "claude/$s removed" test ! -L "$H/.claude/skills/$s"
  check "pi/$s removed" test ! -L "$H/.pi/agent/skills/$s"
done
check "cli link removed" test ! -L "$H/.local/bin/rshow"
check "foreign symlink kept" test -L "$H/.claude/skills/foreign"
check_eq "foreign symlink target kept" "$(readlink "$H/.claude/skills/foreign")" "$H/mine"
check "real file kept" test -f "$H/.pi/agent/skills/note.md"

H=$(new_home)
mkdir -p "$H/.claude/skills"
ln -s "$H/elsewhere" "$H/.claude/skills/foreign"
run "$H" --uninstall claude
check_eq "uninstall with only foreign links exits 0" "$STATUS" 0
check "uninstall left foreign link" test -L "$H/.claude/skills/foreign"

# --- --no-cli ---------------------------------------------------------------
H=$(new_home)
mkdir -p "$H/.claude"
run "$H" --no-cli claude
check_eq "--no-cli exits 0" "$STATUS" 0
check "--no-cli made no bin dir" test ! -e "$H/.local/bin"
check "--no-cli still links skills" test -L "$H/.claude/skills/rshow"

# --- bad input --------------------------------------------------------------
H=$(new_home)
mkdir -p "$H/.claude"
run "$H" nope
check_eq "unknown target exits 2" "$STATUS" 2
check_contains "unknown target prints usage on stderr" "$ERR" "Usage: ./install.sh"
check "unknown target installs nothing" test ! -e "$H/.claude/skills"
run "$H" --bogus
check_eq "unknown flag exits 2" "$STATUS" 2
check_contains "unknown flag prints usage on stderr" "$ERR" "Usage: ./install.sh"
run "$H" --help
check_eq "--help exits 0" "$STATUS" 0
check_contains "--help prints usage" "$OUT" "Usage: ./install.sh"
check_contains "--help mentions targets" "$OUT" "codex"

# --- CLI link runs ----------------------------------------------------------
NODE_MAJOR=0
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR=$(node --version 2>/dev/null | sed 's/^v//' | cut -d. -f1)
  case "$NODE_MAJOR" in
    ''|*[!0-9]*) NODE_MAJOR=0 ;;
  esac
fi
H=$(new_home)
mkdir -p "$H/.claude"
run "$H" claude
check_contains "path hint when bin dir not in PATH" "$ERR" "PATH"
if [ "$NODE_MAJOR" -ge 26 ]; then
  cli_out=$("$H/.local/bin/rshow" --help 2>&1)
  cli_status=$?
  check_eq "rshow --help exits 0" "$cli_status" 0
  check_contains "rshow --help prints usage" "$cli_out" "usage: rshow"
else
  printf '# skip - rshow --help needs node >= 26 (found %s)\n' "$(node --version 2>/dev/null || echo none)"
fi

printf '\n# %d checks, %d failed\n' "$TESTS" "$FAILS"
if [ "$FAILS" -ne 0 ]; then exit 1; fi
exit 0
