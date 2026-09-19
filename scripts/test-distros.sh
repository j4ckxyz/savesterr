#!/usr/bin/env bash
# Runs the Linux binaries in ./dist inside Docker images spanning ~15 years of
# distributions, downloading a real tab in each. Prints a Markdown table.
#
#   bun scripts/build.ts linux-x64 linux-x64-musl && scripts/test-distros.sh
#
# Images marked "expect-fail" are below the supported floor (glibc < 2.17) and
# are included to document where support ends; they don't fail the run.
set -uo pipefail

ARCH="${ARCH:-x64}"          # x64 or arm64
PLATFORM="linux/amd64"; [ "$ARCH" = arm64 ] && PLATFORM="linux/arm64"

# image | libc | expectation
IMAGES=(
  "centos:6|glibc|expect-fail"
  "centos:7|glibc|ok"
  "amazonlinux:2|glibc|ok"
  "ubuntu:16.04|glibc|ok"
  "ubuntu:18.04|glibc|ok"
  "debian:10|glibc|ok"
  "ubuntu:20.04|glibc|ok"
  "debian:11|glibc|ok"
  "ubuntu:22.04|glibc|ok"
  "debian:12|glibc|ok"
  "ubuntu:24.04|glibc|ok"
  "rockylinux:9|glibc|ok"
  "fedora:latest|glibc|ok"
  "archlinux:latest|glibc|ok"
  "alpine:3.16|musl|expect-fail"
  "alpine:3.17|musl|ok"
  "alpine:latest|musl|ok"
)
[ "$ARCH" = arm64 ] && IMAGES=("debian:11|glibc|ok" "ubuntu:24.04|glibc|ok" "alpine:latest|musl|ok")

echo "| Image | C library | Result |"
echo "| --- | --- | --- |"
failed=0
for entry in "${IMAGES[@]}"; do
  IFS='|' read -r image libc expect <<<"$entry"
  bin="songsterr-pdf-linux-$ARCH"; [ "$libc" = musl ] && bin="$bin-musl"
  # Bun's musl builds link against the C++ runtime, which Alpine doesn't ship by default.
  prep=""; [ "$libc" = musl ] && prep="apk add --no-cache libstdc++ libgcc >/dev/null &&"
  out=$(docker run --rm --platform "$PLATFORM" -v "$PWD/dist:/dist:ro" "$image" sh -c "
    $prep v=\$( (ldd --version 2>&1 || true) | head -n1 | grep -oE '[0-9]+\.[0-9]+\$' || echo musl)
    echo \"libc=\$v\"
    /dist/$bin --version && /dist/$bin 444 -t 5 -y --no-open -o /tmp/out >/dev/null && ls /tmp/out/*.pdf >/dev/null && echo RENDER_OK
  " 2>&1)
  libc_ver=$(grep -oE 'libc=[^ ]+' <<<"$out" | head -1 | cut -d= -f2)
  if grep -q RENDER_OK <<<"$out"; then
    result="✅ works"
    [ "$expect" = expect-fail ] && result="✅ works (unexpectedly!)"
  else
    reason=$(grep -vE '^libc=' <<<"$out" | tail -n1 | cut -c1-80)
    if [ "$expect" = expect-fail ]; then result="⛔ unsupported (expected): $reason"
    elif [ "$expect" = probe ]; then result="⛔ doesn't work: $reason"
    else result="❌ FAILED: $reason"; failed=1; echo "$out" >&2; fi
  fi
  [ "$libc" = musl ] && libc_ver=""
  echo "| \`$image\` | $libc ${libc_ver} | $result |"
done
exit $failed
