#!/usr/bin/env bash
set -euo pipefail

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
if (( $# < 1 || $# > 2 )); then
  echo "Usage: $0 <commit-or-tag> [output-directory]" >&2
  exit 1
fi
RELEASE_REF="$1"
OUTPUT_DIRECTORY="${2:-$REPOSITORY_ROOT/artifacts}"
ARCHIVE_NAME="delta-coinbase-guard-v1.zip"
ARCHIVE_PREFIX="delta-coinbase-guard-v1/"
REQUIRED_FILES=(
  "README.md"
  "install"
  "run"
  "docs/COINBASE-CODEX-RECORDING-KIT.md"
  "docs/COINBASE-DEMO-ASSURANCE.md"
  "output/coinbase-demo-panels/00-overview.svg"
  "skills/delta-coinbase-guard/SKILL.md"
  "skills/delta-coinbase-guard/scripts/run"
  "skills/delta-coinbase-guard/references/showcase-response.md"
  "test/installed-skill.test.js"
)

RELEASE_COMMIT="$(
  git -C "$REPOSITORY_ROOT" rev-parse --verify "${RELEASE_REF}^{commit}"
)"
mkdir -p "$OUTPUT_DIRECTORY"

git -C "$REPOSITORY_ROOT" archive \
  --format=zip \
  --prefix="$ARCHIVE_PREFIX" \
  --output="$OUTPUT_DIRECTORY/$ARCHIVE_NAME" \
  "$RELEASE_COMMIT"

for required_file in "${REQUIRED_FILES[@]}"; do
  if ! unzip -Z1 "$OUTPUT_DIRECTORY/$ARCHIVE_NAME" |
    grep -Fqx "$ARCHIVE_PREFIX$required_file"; then
    echo "Release archive is missing required file: $required_file" >&2
    exit 1
  fi
done

if unzip -Z1 "$OUTPUT_DIRECTORY/$ARCHIVE_NAME" |
  grep -Eq "^${ARCHIVE_PREFIX}output/(playwright|pdf)/"; then
  echo "Release archive includes a legacy faux-UI artifact." >&2
  exit 1
fi

if command -v shasum >/dev/null 2>&1; then
  (
    cd "$OUTPUT_DIRECTORY"
    shasum -a 256 "$ARCHIVE_NAME" > "$ARCHIVE_NAME.sha256"
  )
elif command -v sha256sum >/dev/null 2>&1; then
  (
    cd "$OUTPUT_DIRECTORY"
    sha256sum "$ARCHIVE_NAME" > "$ARCHIVE_NAME.sha256"
  )
else
  echo "A SHA-256 utility (shasum or sha256sum) is required." >&2
  exit 1
fi

printf 'Commit: %s\nBundle: %s\nChecksum: %s\n' \
  "$RELEASE_COMMIT" \
  "$OUTPUT_DIRECTORY/$ARCHIVE_NAME" \
  "$OUTPUT_DIRECTORY/$ARCHIVE_NAME.sha256"
