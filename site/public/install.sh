#!/bin/sh
# rshow installer: downloads the rshow single executable for this machine from
# the GitHub release and puts it in ${RSHOW_INSTALL_DIR:-$HOME/.local/bin}.
# The release tarball also holds the bash, zsh and fish completions, and this
# writes each one where its shell reads it.
#
#   curl -fsSL https://rslib.github.io/rshow/install.sh | sh
#
# RSHOW_VERSION        a release such as 0.0.5 (default: the latest one)
# RSHOW_DOWNLOAD_BASE  download from somewhere else, such as file:///tmp/release
# RSHOW_INSTALL_DIR    where rshow goes (default: $HOME/.local/bin)
# RSHOW_NO_COMPLETIONS set to 1 to leave the shell completions out
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

# The hash `name` has in `<sums>`, checked against `<file>`.
check_sum() { # file name sums
  expected=$(awk -v name="$2" '$2 == name { print $1; exit }' "$3")
  [ -n "$expected" ] || die "SHA256SUMS holds no line for $2; or use $NPM_HINT"
  actual=$(sha256 "$1")
  [ "$actual" = "$expected" ] || die "checksum mismatch for $2: SHA256SUMS says $expected, the download is $actual"
}

# One completion file, in the folder its shell reads.
put_completion() { # file target
  [ -f "$1" ] || return 0
  folder=$(dirname "$2")
  mkdir -p "$folder" || die "cannot create $folder"
  cp "$1" "$2" || die "cannot write $2"
  say "rshow: installed $2"
}

# The completions the tarball carries, in the place each shell looks.
completions() { # folder holding rshow.bash, _rshow and rshow.fish
  if [ "${RSHOW_NO_COMPLETIONS:-}" = 1 ]; then
    return 0
  fi
  data=${XDG_DATA_HOME:-$HOME/.local/share}
  config=${XDG_CONFIG_HOME:-$HOME/.config}
  put_completion "$1/rshow.bash" "$data/bash-completion/completions/rshow"
  put_completion "$1/_rshow" "$data/zsh/site-functions/_rshow"
  put_completion "$1/rshow.fish" "$config/fish/completions/rshow.fish"
  case "${SHELL:-}" in
    *zsh)
      say 'rshow: for zsh, put this before compinit in ~/.zshrc:'
      say "  fpath=($data/zsh/site-functions \$fpath)"
      ;;
  esac
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

  dir=${RSHOW_INSTALL_DIR:-$HOME/.local/bin}
  mkdir -p "$dir" || die "cannot create $dir"

  tarball=rshow-$TARGET.tar.gz
  say "rshow: downloading $base/$tarball"
  # A release old enough to hold no tarball says so on its own, one line below.
  if download "$base/$tarball" "$tmp/$tarball" 2>/dev/null; then
    download "$base/SHA256SUMS" "$tmp/SHA256SUMS" || die "cannot download $base/SHA256SUMS; or use $NPM_HINT"
    check_sum "$tmp/$tarball" "$tarball" "$tmp/SHA256SUMS"
    tar -xzf "$tmp/$tarball" -C "$tmp" || die "cannot unpack $tarball; or use $NPM_HINT"
    binary="$tmp/rshow-$TARGET/rshow"
    [ -f "$binary" ] || die "$tarball holds no rshow-$TARGET/rshow; or use $NPM_HINT"
    chmod 755 "$binary" || die "cannot make $binary executable"
    mv "$binary" "$dir/rshow" || die "cannot write $dir/rshow"
    say "rshow: installed $dir/rshow"
    completions "$tmp/rshow-$TARGET/completions"
  else
    # 0.0.2 to 0.0.5 published the plain binary, with no completions beside it.
    say "rshow: this release has no $tarball; installing the plain binary"
    download "$base/rshow-$TARGET" "$tmp/rshow" || die "cannot download $base/rshow-$TARGET; check RSHOW_VERSION, or use $NPM_HINT"
    download "$base/SHA256SUMS" "$tmp/SHA256SUMS" || die "cannot download $base/SHA256SUMS; or use $NPM_HINT"
    check_sum "$tmp/rshow" "rshow-$TARGET" "$tmp/SHA256SUMS"
    chmod 755 "$tmp/rshow" || die "cannot make $tmp/rshow executable"
    mv "$tmp/rshow" "$dir/rshow" || die "cannot write $dir/rshow"
    say "rshow: installed $dir/rshow"
  fi

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
  say '  rshow login          # saves the token in the Keychain, the keyring or a 0600 file'
  say '  rshow skills install'
  say '  rshow doctor'
}

main "$@"
