#!/bin/sh
# rshow installer: downloads the rshow single executable for this machine from
# the GitHub release and puts it in ${RSHOW_INSTALL_DIR:-$HOME/.local/bin}.
#
#   curl -fsSL https://rslib.github.io/rshow/install.sh | sh
#
# RSHOW_VERSION        a release such as 0.0.2 (default: the latest one)
# RSHOW_DOWNLOAD_BASE  download from somewhere else, such as file:///tmp/release
# RSHOW_INSTALL_DIR    where rshow goes (default: $HOME/.local/bin)
set -eu

REPO=rslib/rshow
NPM_HINT='npm i -g rshow'

say() {
  printf '%s\n' "$*"
}

die() {
  printf 'rshow: %s\n' "$*" >&2
  exit 1
}

# Only linux-x64, linux-arm64 and darwin-arm64 are built; anything else, and a
# platform this script cannot read, falls back to the npm package.
target() {
  os=$(uname -s 2>/dev/null || echo unknown)
  arch=$(uname -m 2>/dev/null || echo unknown)
  case "$os" in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    *) return 1 ;;
  esac
  case "$arch" in
    x86_64|amd64) arch=x64 ;;
    arm64|aarch64) arch=arm64 ;;
    *) return 1 ;;
  esac
  case "$os-$arch" in
    linux-x64|linux-arm64|darwin-arm64) printf '%s\n' "$os-$arch" ;;
    *) return 1 ;;
  esac
}

download() { # url file
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$2" "$1"
  else
    die "neither curl nor wget is installed; use $NPM_HINT"
  fi
}

sha256() { # file
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{ print $1 }'
  else
    die "neither sha256sum nor shasum is installed, so the download cannot be checked; use $NPM_HINT"
  fi
}

# Everything runs from main, called on the last line, so a download cut short
# by `curl | sh` runs nothing.
main() {
  TARGET=$(target) || die "no rshow binary for $(uname -s 2>/dev/null) $(uname -m 2>/dev/null); use $NPM_HINT (needs node 22 or later)"

  base=${RSHOW_DOWNLOAD_BASE:-}
  version=${RSHOW_VERSION:-}
  if [ -n "$base" ]; then
    base=${base%/}
  elif [ -n "$version" ]; then
    base="https://github.com/$REPO/releases/download/v${version#v}"
  else
    base="https://github.com/$REPO/releases/latest/download"
  fi

  tmp=$(mktemp -d "${TMPDIR:-/tmp}/rshow-install.XXXXXX" 2>/dev/null || mktemp -d)
  trap 'rm -rf "$tmp"' EXIT HUP INT TERM

  say "rshow: downloading $base/rshow-$TARGET"
  download "$base/rshow-$TARGET" "$tmp/rshow" || die "cannot download $base/rshow-$TARGET; check RSHOW_VERSION, or use $NPM_HINT"
  download "$base/SHA256SUMS" "$tmp/SHA256SUMS" || die "cannot download $base/SHA256SUMS; or use $NPM_HINT"

  expected=$(awk -v name="rshow-$TARGET" '$2 == name { print $1; exit }' "$tmp/SHA256SUMS")
  [ -n "$expected" ] || die "SHA256SUMS holds no line for rshow-$TARGET; or use $NPM_HINT"
  actual=$(sha256 "$tmp/rshow")
  [ "$actual" = "$expected" ] || die "checksum mismatch for rshow-$TARGET: SHA256SUMS says $expected, the download is $actual"

  dir=${RSHOW_INSTALL_DIR:-$HOME/.local/bin}
  mkdir -p "$dir" || die "cannot create $dir"
  chmod 755 "$tmp/rshow" || die "cannot make $tmp/rshow executable"
  mv "$tmp/rshow" "$dir/rshow" || die "cannot write $dir/rshow"
  say "rshow: installed $dir/rshow"

  installed=$("$dir/rshow" --version 2>/dev/null) || die "$dir/rshow does not run; use $NPM_HINT"
  [ -n "$installed" ] || die "$dir/rshow printed no version; use $NPM_HINT"
  say "$installed"

  case ":${PATH:-}:" in
    *":$dir:"*) ;;
    *)
      say "rshow: $dir is not in PATH; add it with:"
      say "  export PATH=\"$dir:\$PATH\""
      ;;
  esac

  say ''
  say 'next:'
  say '  rshow init --url <admin-url> --art <viewer-url>'
  case "$TARGET" in
    darwin-*) say '  rshow login          # saves the token in the Keychain' ;;
    *) say '  export RSHOW_TOKEN=...   # outside macOS rshow reads the token from the environment' ;;
  esac
  say '  rshow skills install'
  say '  rshow doctor'
}

main "$@"
