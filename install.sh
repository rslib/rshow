#!/usr/bin/env bash
# rshow installer - symlinks the rshow skills and CLI into place.
#
# Usage: ./install.sh [--uninstall] [--dry-run] [--list] [-h|--help] [target ...]
#   targets:  claude -> $HOME/.claude/skills
#             pi     -> $HOME/.pi/agent/skills
#             codex  -> $HOME/.codex/skills
#   With no target, every target whose parent directory exists is used.
#   --uninstall  remove the symlinks this script created
#   --dry-run    print what would happen, change nothing
#   --list       print each target, its dir and whether it is detected
#   --no-cli     do not link the CLI into $HOME/.local/bin
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./install.sh [--uninstall] [--dry-run] [--list] [target ...]

Targets:
  claude   $HOME/.claude/skills
  pi       $HOME/.pi/agent/skills
  codex    $HOME/.codex/skills

With no target, every target whose parent directory exists is used.

Options:
  --uninstall   remove the symlinks this script created
  --dry-run     print what would happen, change nothing
  --list        print each target, its dir and whether it is detected
  --no-cli      do not link the CLI into $HOME/.local/bin
  -h, --help    show this help
EOF
}

SCRIPT_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]:-$0}")" >/dev/null 2>&1 && pwd -P)
SKILLS_DIR=$SCRIPT_DIR/skills
CLI_SRC=$SCRIPT_DIR/packages/cli/src/main.ts
CLI_DIR=$HOME/.local/bin
CLI_DST=$CLI_DIR/rshow
NODE_MIN_MAJOR=26
ALL_TARGETS="claude pi codex"

failed=0

say() {
  if [ "$dry_run" -eq 1 ]; then
    printf 'would %s\n' "$*"
  else
    printf '%s\n' "$*"
  fi
}

warn() {
  printf '%s\n' "$*" >&2
}

target_parent() {
  case "$1" in
    claude) printf '%s\n' "$HOME/.claude" ;;
    pi) printf '%s\n' "$HOME/.pi/agent" ;;
    codex) printf '%s\n' "$HOME/.codex" ;;
  esac
}

target_dir() {
  printf '%s/skills\n' "$(target_parent "$1")"
}

link_abs() {
  local cur
  cur=$(readlink "$1")
  case "$cur" in
    /*) printf '%s\n' "$cur" ;;
    *) printf '%s\n' "$(dirname "$1")/$cur" ;;
  esac
}

under() {
  case "$1" in
    "$2"*) return 0 ;;
  esac
  return 1
}

make_link() { # dst src own_prefix
  local dst=$1 src=$2 prefix=$3 cur
  if [ -L "$dst" ]; then
    cur=$(link_abs "$dst")
    if [ "$cur" = "$src" ]; then
      say "ok $dst"
      return 0
    fi
    if under "$cur" "$prefix"; then
      if [ "$dry_run" -eq 0 ]; then ln -sfn "$src" "$dst"; fi
      say "linked $dst"
      return 0
    fi
    warn "skip $dst: exists and is not from this repo"
    failed=1
    return 0
  fi
  if [ -e "$dst" ]; then
    warn "skip $dst: exists and is not from this repo"
    failed=1
    return 0
  fi
  if [ "$dry_run" -eq 0 ]; then ln -s "$src" "$dst"; fi
  say "linked $dst"
}

remove_stale() { # dir own_prefix
  local dir=$1 prefix=$2 entry
  [ -d "$dir" ] || return 0
  for entry in "$dir"/*; do
    [ -L "$entry" ] || continue
    under "$(link_abs "$entry")" "$prefix" || continue
    if [ -e "$entry" ]; then continue; fi
    if [ "$dry_run" -eq 0 ]; then rm -f "$entry"; fi
    say "removed $entry"
  done
}

remove_ours() { # dir own_prefix
  local dir=$1 prefix=$2 entry
  [ -d "$dir" ] || return 0
  for entry in "$dir"/*; do
    [ -L "$entry" ] || continue
    under "$(link_abs "$entry")" "$prefix" || continue
    if [ "$dry_run" -eq 0 ]; then rm -f "$entry"; fi
    say "removed $entry"
  done
}

check_node() {
  local v major
  if ! command -v node >/dev/null 2>&1; then
    warn "warning: node not found on PATH; rshow needs Node >= $NODE_MIN_MAJOR"
    return 0
  fi
  v=$(node --version 2>/dev/null || true)
  major=${v#v}
  major=${major%%.*}
  case "$major" in
    ''|*[!0-9]*)
      warn "warning: could not read node version (need >= $NODE_MIN_MAJOR)"
      return 0
      ;;
  esac
  if [ "$major" -lt "$NODE_MIN_MAJOR" ]; then
    warn "warning: node $v is too old; rshow needs Node >= $NODE_MIN_MAJOR"
  fi
}

path_hint() {
  case ":$PATH:" in
    *":$CLI_DIR:"*) return 0 ;;
  esac
  warn "hint: add $CLI_DIR to PATH to run rshow from any directory"
}

uninstall=0
dry_run=0
list=0
no_cli=0
requested=""

for arg in "$@"; do
  case "$arg" in
    --uninstall) uninstall=1 ;;
    --dry-run) dry_run=1 ;;
    --list) list=1 ;;
    --no-cli) no_cli=1 ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      usage >&2
      exit 2
      ;;
    *)
      case "$arg" in
        claude|pi|codex) requested="$requested $arg" ;;
        *)
          usage >&2
          exit 2
          ;;
      esac
      ;;
  esac
done

if [ "$list" -eq 1 ]; then
  for t in ${requested:-$ALL_TARGETS}; do
    if [ -d "$(target_parent "$t")" ]; then
      state=detected
    else
      state="not detected"
    fi
    printf '%s  %s  %s\n' "$t" "$(target_dir "$t")" "$state"
  done
  exit 0
fi

chosen=$requested
if [ -z "$chosen" ]; then
  for t in $ALL_TARGETS; do
    if [ -d "$(target_parent "$t")" ]; then
      chosen="$chosen $t"
    fi
  done
fi

if [ -z "$chosen" ]; then
  warn "no targets detected (looked for $HOME/.claude, $HOME/.pi/agent, $HOME/.codex)"
fi

if [ "$uninstall" -eq 1 ]; then
  for t in $chosen; do
    remove_ours "$(target_dir "$t")" "$SKILLS_DIR/"
  done
  if [ "$no_cli" -eq 0 ]; then
    if [ -L "$CLI_DST" ] && under "$(link_abs "$CLI_DST")" "$SCRIPT_DIR/"; then
      if [ "$dry_run" -eq 0 ]; then rm -f "$CLI_DST"; fi
      say "removed $CLI_DST"
    fi
  fi
  exit "$failed"
fi

skill_names=""
for f in "$SKILLS_DIR"/*/SKILL.md; do
  [ -e "$f" ] || continue
  skill_names="$skill_names $(basename "$(dirname "$f")")"
done

for t in $chosen; do
  dir=$(target_dir "$t")
  if [ "$dry_run" -eq 0 ]; then mkdir -p "$dir"; fi
  remove_stale "$dir" "$SKILLS_DIR/"
  for name in $skill_names; do
    make_link "$dir/$name" "$SKILLS_DIR/$name" "$SKILLS_DIR/"
  done
done

if [ "$no_cli" -eq 0 ]; then
  if [ "$dry_run" -eq 0 ]; then mkdir -p "$CLI_DIR"; fi
  make_link "$CLI_DST" "$CLI_SRC" "$SCRIPT_DIR/"
  check_node
  path_hint
fi

exit "$failed"
