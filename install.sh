#!/bin/sh
# Installs the Selah binary for this machine from the GitHub release.
#
#   curl -fsSL https://raw.githubusercontent.com/hallelx2/selah/main/install.sh | sh
#
# Environment:
#   SELAH_VERSION      a release tag such as v0.1.0 (default: the latest release)
#   SELAH_INSTALL_DIR  where to put the binary (default: ~/.local/bin)
#   SELAH_DOWNLOAD_BASE  override the download URL prefix (used by tests)
set -eu

REPO="hallelx2/selah"
VERSION="${SELAH_VERSION:-latest}"
DIR="${SELAH_INSTALL_DIR:-$HOME/.local/bin}"

say() { printf '  %s\n' "$*"; }
fail() { printf '\n  error: %s\n\n' "$*" >&2; exit 1; }

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *) fail "unsupported system $(uname -s); build from source with bun (see the README)" ;;
esac

case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) fail "unsupported CPU $(uname -m)" ;;
esac

# Rosetta reports x86_64 on Apple silicon; the native build is faster.
if [ "$os" = darwin ] && [ "$arch" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then
  arch=arm64
fi

libc=""
if [ "$os" = linux ] && { ldd --version 2>&1 | grep -qi musl || [ -e /lib/ld-musl-x86_64.so.1 ] || [ -e /lib/ld-musl-aarch64.so.1 ]; }; then
  libc="-musl"
fi

asset="selah-$os-$arch$libc"
if [ -n "${SELAH_DOWNLOAD_BASE:-}" ]; then
  base="$SELAH_DOWNLOAD_BASE"
elif [ "$VERSION" = latest ]; then
  base="https://github.com/$REPO/releases/latest/download"
else
  base="https://github.com/$REPO/releases/download/$VERSION"
fi

if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL --retry 3 -o "$2" "$1"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -q -O "$2" "$1"; }
else
  fail "need curl or wget"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM

printf '\n  Selah, a Bible for the terminal\n\n'
say "downloading $asset ($VERSION)"
fetch "$base/$asset" "$tmp/selah" || fail "could not download $base/$asset"
fetch "$base/SHA256SUMS" "$tmp/SHA256SUMS" || fail "could not download the checksums"

expected="$(grep " $asset\$" "$tmp/SHA256SUMS" | cut -d' ' -f1)"
[ -n "$expected" ] || fail "no checksum listed for $asset"
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp/selah" | cut -d' ' -f1)"
else
  actual="$(shasum -a 256 "$tmp/selah" | cut -d' ' -f1)"
fi
[ "$expected" = "$actual" ] || fail "checksum mismatch for $asset (expected $expected, got $actual)"
say "checksum ok"

mkdir -p "$DIR"
chmod 755 "$tmp/selah"
mv "$tmp/selah" "$DIR/selah"
if [ "$os" = darwin ]; then
  xattr -d com.apple.quarantine "$DIR/selah" 2>/dev/null || true
fi
say "installed $("$DIR/selah" --version 2>/dev/null || echo "$VERSION") to $DIR/selah"

case ":$PATH:" in
  *":$DIR:"*) ;;
  *)
    say ""
    say "$DIR is not on your PATH. Add this to your shell profile:"
    say "  export PATH=\"$DIR:\$PATH\""
    ;;
esac

printf '\n  Run  selah  to start. The first launch downloads the KJV and BSB once (about 16 MB).\n\n'
