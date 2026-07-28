#!/usr/bin/env bash
set -euo pipefail

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
if (( $# > 2 )); then
  echo "Usage: $0 [commit-or-tag] [output-directory]" >&2
  exit 1
fi

RELEASE_REF="${1:-HEAD}"
if [[ ! "$RELEASE_REF" =~ ^[A-Za-z0-9._/-]+$ ]]; then
  echo "Release ref contains unsupported characters: $RELEASE_REF" >&2
  exit 1
fi

OUTPUT_DIRECTORY="${2:-$REPOSITORY_ROOT/artifacts}"
mkdir -p "$OUTPUT_DIRECTORY"
OUTPUT_DIRECTORY="$(cd "$OUTPUT_DIRECTORY" && pwd -P)"

RELEASE_COMMIT="$(
  git -C "$REPOSITORY_ROOT" rev-parse --verify "${RELEASE_REF}^{commit}"
)"

BUILD_DIRECTORY="$(
  mktemp -d "${TMPDIR:-/tmp}/delta-coinbase-guard-release.XXXXXX"
)"
cleanup() {
  rm -rf -- "$BUILD_DIRECTORY"
}
trap cleanup EXIT HUP INT TERM

git -C "$REPOSITORY_ROOT" show \
  "$RELEASE_COMMIT:package.json" > "$BUILD_DIRECTORY/package.json"

if [[ -n "${HARNESS_NODE_BINARY:-}" ]] && [[ -x "$HARNESS_NODE_BINARY" ]]; then
  NODE_BINARY="$HARNESS_NODE_BINARY"
elif command -v node >/dev/null 2>&1; then
  NODE_BINARY="$(command -v node)"
else
  echo "Node.js 22 or newer is required to build a release bundle." >&2
  exit 1
fi
NODE_BINARY="$("$NODE_BINARY" -p 'require("node:fs").realpathSync(process.execPath)')"

VERSION="$(
  "$NODE_BINARY" -e \
    'const p = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); process.stdout.write(String(p.version ?? ""));' \
    "$BUILD_DIRECTORY/package.json"
)"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "package.json at $RELEASE_COMMIT has an invalid release version: $VERSION" >&2
  exit 1
fi
if [[ "$RELEASE_REF" == v* ]] && [[ "$RELEASE_REF" != "v$VERSION" ]]; then
  echo "Tag $RELEASE_REF does not match package version $VERSION." >&2
  exit 1
fi

ARCHIVE_STEM="delta-coinbase-guard-v$VERSION"
ARCHIVE_NAME="$ARCHIVE_STEM.zip"
ARCHIVE_PREFIX="$ARCHIVE_STEM/"
ARCHIVE_LIST="$BUILD_DIRECTORY/archive-list.txt"
mkdir -p "$BUILD_DIRECTORY/first" "$BUILD_DIRECTORY/second"
FIRST_ARCHIVE="$BUILD_DIRECTORY/first/$ARCHIVE_NAME"
SECOND_ARCHIVE="$BUILD_DIRECTORY/second/$ARCHIVE_NAME"

git -C "$REPOSITORY_ROOT" archive \
  --format=zip \
  --prefix="$ARCHIVE_PREFIX" \
  --output="$FIRST_ARCHIVE" \
  "$RELEASE_COMMIT"
git -C "$REPOSITORY_ROOT" archive \
  --format=zip \
  --prefix="$ARCHIVE_PREFIX" \
  --output="$SECOND_ARCHIVE" \
  "$RELEASE_COMMIT"
if ! cmp -s "$FIRST_ARCHIVE" "$SECOND_ARCHIVE"; then
  echo "git archive did not produce a deterministic bundle for $RELEASE_COMMIT." >&2
  exit 1
fi

unzip -Z1 "$FIRST_ARCHIVE" > "$ARCHIVE_LIST"

REQUIRED_FILES=(
  "README.md"
  "SECURITY.md"
  "package.json"
  "install"
  "run"
  "config/coinbase-spot-policy.v2.schema.json"
  "config/preview-capability-profile.json"
  "config/execution-safety-profile.json"
  "src/cli.js"
  "src/funding.js"
  "src/spot-action.js"
  "src/mandate/controller.js"
  "docs/COINBASE-CREDENTIAL-SETUP.md"
  "docs/COINBASE-CODEX-RECORDING-KIT.md"
  "docs/COINBASE-DEMO-ASSURANCE.md"
  "examples/generic-buy-intent.txt"
  "examples/generic-sell-intent.txt"
  "output/coinbase-demo-panels/00-overview.svg"
  "skills/delta-coinbase-guard/SKILL.md"
  "skills/delta-coinbase-guard/agents/openai.yaml"
  "skills/delta-coinbase-guard/scripts/run"
  "skills/delta-coinbase-guard/references/workflow.md"
  "skills/delta-coinbase-guard/references/security-boundary.md"
  "skills/delta-coinbase-guard/references/showcase-response.md"
  "scripts/check-local-links.mjs"
  "scripts/validate-release-metadata.mjs"
  "scripts/validate-skill.mjs"
)
for required_file in "${REQUIRED_FILES[@]}"; do
  if ! grep -Fqx "$ARCHIVE_PREFIX$required_file" "$ARCHIVE_LIST"; then
    echo "Release archive is missing required file: $required_file" >&2
    exit 1
  fi
done

while IFS= read -r archive_path; do
  if [[ "$archive_path" != "$ARCHIVE_PREFIX"* ]]; then
    echo "Release archive contains a path outside its versioned root: $archive_path" >&2
    exit 1
  fi
  relative_path="${archive_path#"$ARCHIVE_PREFIX"}"
  lowercase_path="$(
    printf '%s' "$relative_path" | tr '[:upper:]' '[:lower:]'
  )"
  case "$lowercase_path" in
    ""|*/ )
      ;;
    .git|.git/*|.gitignore|.gitattributes|.github/*|\
    node_modules/*|*/node_modules/*|\
    runtime/*|*/runtime/*|tmp/*|*/tmp/*|\
    credentials/*|*/credentials/*|artifacts/*|*/artifacts/*|\
    .delta-coinbase-guard-node|*/.delta-coinbase-guard-node|\
    .env|.env.*|*/.env|*/.env.*|\
    *.pem|*.key|*.jwk|*.p12|*.pfx|\
    *api_key*.json|*cdp_key*.json|*credential*.json|\
    output/playwright/*|output/pdf/*|__macosx/*|*/.ds_store )
      echo "Release archive contains a forbidden path: $relative_path" >&2
      exit 1
      ;;
  esac
done < "$ARCHIVE_LIST"

env \
  HARNESS_NODE_BINARY="$NODE_BINARY" \
  "$REPOSITORY_ROOT/scripts/validate-release-bundle.sh" \
  "$FIRST_ARCHIVE"

FINAL_ARCHIVE="$OUTPUT_DIRECTORY/$ARCHIVE_NAME"
CHECKSUM_NAME="$ARCHIVE_NAME.sha256"
CHECKSUM_PATH="$OUTPUT_DIRECTORY/$CHECKSUM_NAME"
MANIFEST_NAME="$ARCHIVE_STEM.manifest.json"
MANIFEST_PATH="$OUTPUT_DIRECTORY/$MANIFEST_NAME"
STABLE_ARCHIVE_NAME="delta-coinbase-guard-v1.zip"
STABLE_ARCHIVE_PATH="$OUTPUT_DIRECTORY/$STABLE_ARCHIVE_NAME"
STABLE_CHECKSUM_NAME="$STABLE_ARCHIVE_NAME.sha256"
STABLE_CHECKSUM_PATH="$OUTPUT_DIRECTORY/$STABLE_CHECKSUM_NAME"

for release_output in \
  "$FINAL_ARCHIVE" \
  "$CHECKSUM_PATH" \
  "$MANIFEST_PATH" \
  "$STABLE_ARCHIVE_PATH" \
  "$STABLE_CHECKSUM_PATH"; do
  if [[ -L "$release_output" ]]; then
    echo "Refusing to write a release artifact through a symlink: $release_output" >&2
    exit 1
  fi
done

mv -f "$FIRST_ARCHIVE" "$FINAL_ARCHIVE"
SHA256="$(
  "$NODE_BINARY" -e \
    'const fs = require("node:fs"); const crypto = require("node:crypto"); const hash = crypto.createHash("sha256"); hash.update(fs.readFileSync(process.argv[1])); process.stdout.write(hash.digest("hex"));' \
    "$FINAL_ARCHIVE"
)"
printf '%s  %s\n' "$SHA256" "$ARCHIVE_NAME" > "$CHECKSUM_PATH"
cp -f "$FINAL_ARCHIVE" "$STABLE_ARCHIVE_PATH"
if ! cmp -s "$FINAL_ARCHIVE" "$STABLE_ARCHIVE_PATH"; then
  echo "Stable release alias does not match the versioned archive." >&2
  exit 1
fi
printf '%s  %s\n' "$SHA256" "$STABLE_ARCHIVE_NAME" > "$STABLE_CHECKSUM_PATH"

"$NODE_BINARY" -e '
  const fs = require("node:fs");
  const manifest = {
    schema_version: "delta.coinbase.release_manifest.v1",
    product: "Delta Coinbase Guard",
    version: process.argv[1],
    commit: process.argv[2],
    archive: process.argv[3],
    archive_prefix: process.argv[4],
    sha256: process.argv[5],
    stable_archive_alias: process.argv[6],
    stable_checksum_alias: process.argv[7],
    node_minimum_major: 22,
    create_enabled: false,
    deterministic_archive_verified: true,
    cold_install_verified: true,
  };
  fs.writeFileSync(process.argv[8], `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o644,
  });
' \
  "$VERSION" \
  "$RELEASE_COMMIT" \
  "$ARCHIVE_NAME" \
  "$ARCHIVE_PREFIX" \
  "$SHA256" \
  "$STABLE_ARCHIVE_NAME" \
  "$STABLE_CHECKSUM_NAME" \
  "$MANIFEST_PATH"

chmod 0644 \
  "$FINAL_ARCHIVE" \
  "$CHECKSUM_PATH" \
  "$MANIFEST_PATH" \
  "$STABLE_ARCHIVE_PATH" \
  "$STABLE_CHECKSUM_PATH"

printf 'Commit: %s\nVersion: %s\nBundle: %s\nChecksum: %s\nManifest: %s\nStable bundle: %s\nStable checksum: %s\n' \
  "$RELEASE_COMMIT" \
  "$VERSION" \
  "$FINAL_ARCHIVE" \
  "$CHECKSUM_PATH" \
  "$MANIFEST_PATH" \
  "$STABLE_ARCHIVE_PATH" \
  "$STABLE_CHECKSUM_PATH"
