#!/bin/sh
# savesterr installer for macOS and Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/j4ckxyz/savesterr/main/install.sh | sh
#
# Environment overrides:
#   SAVESTERR_INSTALL_DIR  where to put the binary   (default: ~/.local/bin)
#   SAVESTERR_VERSION      e.g. 1.0.0                (default: latest)
#   SAVESTERR_REPO         owner/repo on GitHub      (default: j4ckxyz/savesterr)
#   SAVESTERR_NO_MODIFY_PATH=1  don't touch shell startup files
set -eu

REPO="${SAVESTERR_REPO:-j4ckxyz/savesterr}"
INSTALL_DIR="${SAVESTERR_INSTALL_DIR:-$HOME/.local/bin}"
VERSION="${SAVESTERR_VERSION:-latest}"
BIN="savesterr"

if [ -t 1 ]; then
  bold=$(printf '\033[1m'); green=$(printf '\033[32m'); red=$(printf '\033[31m'); dim=$(printf '\033[2m'); reset=$(printf '\033[0m')
else
  bold=""; green=""; red=""; dim=""; reset=""
fi
info() { printf '%s\n' "${dim}›${reset} $*"; }
fail() { printf '%s\n' "${red}error${reset}: $*" >&2; exit 1; }

# ── Detect platform ──────────────────────────────────────────────────────────
os=$(uname -s)
arch=$(uname -m)
case "$os" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  MINGW* | MSYS* | CYGWIN*) fail "on Windows, run this in PowerShell instead:
  irm https://raw.githubusercontent.com/$REPO/main/install.ps1 | iex" ;;
  *) fail "unsupported operating system: $os" ;;
esac
case "$arch" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) fail "unsupported CPU architecture: $arch (need x86_64 or arm64)" ;;
esac

if [ "$os" = darwin ]; then
  # An x64 shell under Rosetta on Apple Silicon should still get the native build.
  if [ "$arch" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then arch=arm64; fi
  major=$(sw_vers -productVersion | cut -d. -f1)
  [ "$major" -ge 13 ] || fail "macOS 13 (Ventura) or newer is required; this Mac has $(sw_vers -productVersion)"
fi

variant=""
if [ "$os" = linux ]; then
  # Alpine, Void and friends use musl instead of glibc.
  if ls /lib/ld-musl-* >/dev/null 2>&1 || (ldd --version 2>&1 | grep -qi musl); then
    variant="-musl"
    # The musl build needs the C++ runtime, which Alpine doesn't install by default.
    if ! ls /usr/lib/libstdc++.so.6* /lib/libstdc++.so.6* >/dev/null 2>&1; then
      if command -v apk >/dev/null 2>&1; then
        fail "savesterr needs the C++ runtime. Install it, then re-run this installer:
  apk add libstdc++ libgcc      (prefix with sudo/doas if you're not root)"
      fi
      fail "savesterr needs the C++ runtime (libstdc++ and libgcc). Install them with your package manager, then re-run this installer."
    fi
  fi
  if [ "$arch" = x64 ] && [ -r /proc/cpuinfo ] && ! grep -q sse4_2 /proc/cpuinfo; then
    fail "this CPU lacks SSE4.2, which is required (any x86-64 CPU from ~2009 onwards has it)"
  fi
fi

asset="$BIN-$os-$arch$variant"
if [ "$VERSION" = latest ]; then
  url="https://github.com/$REPO/releases/latest/download"
  tag=""
else
  tag="v${VERSION#v}"
  url="https://github.com/$REPO/releases/download/$tag"
fi

# ── Download ─────────────────────────────────────────────────────────────────
tmp=$(mktemp -d 2>/dev/null || mktemp -d -t savesterr)
trap 'rm -rf "$tmp"' EXIT INT TERM

fetch() { # url dest
  if command -v curl >/dev/null 2>&1; then curl -fsSL --retry 3 -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then wget -q -O "$2" "$1"
  else fail "need curl or wget to download"; fi
}

printf '%s\n' "${bold}Installing savesterr${reset} ${dim}($os-$arch$variant)${reset}"
info "Downloading $asset"
if ! fetch "$url/$asset" "$tmp/$BIN" 2>/dev/null || ! fetch "$url/SHA256SUMS" "$tmp/SHA256SUMS" 2>/dev/null; then
  # Private repositories aren't downloadable anonymously; fall back to the GitHub CLI's login.
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    info "Public download unavailable, using your GitHub CLI login"
    rm -f "$tmp/$BIN" "$tmp/SHA256SUMS"
    gh release download $tag --repo "$REPO" --pattern "$asset" --pattern SHA256SUMS --dir "$tmp" ||
      fail "couldn't download $asset from $REPO"
    mv "$tmp/$asset" "$tmp/$BIN"
  else
    fail "couldn't download $url/$asset
  If the repository is private, install the GitHub CLI (https://cli.github.com), run \`gh auth login\`, and try again."
  fi
fi

# ── Verify ───────────────────────────────────────────────────────────────────
expected=$(grep " $asset\$" "$tmp/SHA256SUMS" | cut -d' ' -f1)
if command -v sha256sum >/dev/null 2>&1; then actual=$(sha256sum "$tmp/$BIN" | cut -d' ' -f1)
elif command -v shasum >/dev/null 2>&1; then actual=$(shasum -a 256 "$tmp/$BIN" | cut -d' ' -f1)
else actual=""; info "No sha256 tool found; skipping checksum verification"; fi
if [ -n "$actual" ]; then
  [ -n "$expected" ] && [ "$expected" = "$actual" ] || fail "checksum mismatch for $asset — download corrupted?"
  info "Checksum verified"
fi

# ── Install ──────────────────────────────────────────────────────────────────
mkdir -p "$INSTALL_DIR"
chmod +x "$tmp/$BIN"
[ "$os" = darwin ] && xattr -d com.apple.quarantine "$tmp/$BIN" 2>/dev/null || true
mv -f "$tmp/$BIN" "$INSTALL_DIR/$BIN" || fail "couldn't write to $INSTALL_DIR (try SAVESTERR_INSTALL_DIR=... or sudo)"
installed=$("$INSTALL_DIR/$BIN" --version 2>&1) || fail "the installed binary failed to run:
$installed"
info "Installed $installed to $INSTALL_DIR/$BIN"

# ── PATH ─────────────────────────────────────────────────────────────────────
on_path=false
case ":$PATH:" in *":$INSTALL_DIR:"*) on_path=true ;; esac

if [ "$on_path" = false ] && [ -z "${SAVESTERR_NO_MODIFY_PATH:-}" ]; then
  shell_name=$(basename "${SHELL:-sh}")
  case "$shell_name" in
    zsh) rc="${ZDOTDIR:-$HOME}/.zshrc"; line="export PATH=\"$INSTALL_DIR:\$PATH\"" ;;
    bash)
      if [ "$os" = darwin ]; then rc="$HOME/.bash_profile"; else rc="$HOME/.bashrc"; fi
      line="export PATH=\"$INSTALL_DIR:\$PATH\"" ;;
    fish) rc="${XDG_CONFIG_HOME:-$HOME/.config}/fish/config.fish"; line="fish_add_path \"$INSTALL_DIR\"" ;;
    *) rc="$HOME/.profile"; line="export PATH=\"$INSTALL_DIR:\$PATH\"" ;;
  esac
  mkdir -p "$(dirname "$rc")"
  if ! grep -qs "$INSTALL_DIR" "$rc"; then
    printf '\n# savesterr\n%s\n' "$line" >>"$rc"
    info "Added $INSTALL_DIR to your PATH in $rc"
  fi
fi

printf '\n%s\n' "${green}✓${reset} ${bold}savesterr is installed!${reset}"
if [ "$on_path" = true ]; then
  printf '%s\n' "  Run it with: ${bold}savesterr${reset}"
else
  printf '%s\n' "  Open a new terminal, then run: ${bold}savesterr${reset}"
  printf '%s\n' "  ${dim}(or right now: $INSTALL_DIR/$BIN)${reset}"
fi
