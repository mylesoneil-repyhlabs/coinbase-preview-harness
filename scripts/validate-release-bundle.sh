#!/usr/bin/env bash
set -euo pipefail

if (( $# != 1 )); then
  echo "Usage: $0 /absolute/path/to/delta-coinbase-guard-vX.Y.Z.zip" >&2
  exit 1
fi

ARCHIVE_PATH="$1"
if [[ ! -f "$ARCHIVE_PATH" ]]; then
  echo "Release archive not found: $ARCHIVE_PATH" >&2
  exit 1
fi
ARCHIVE_DIRECTORY="$(cd "$(dirname "$ARCHIVE_PATH")" && pwd -P)"
ARCHIVE_PATH="$ARCHIVE_DIRECTORY/$(basename "$ARCHIVE_PATH")"

compatible_node() {
  local candidate="$1"
  local candidate_major
  [[ -x "$candidate" ]] || return 1
  candidate_major="$(
    "$candidate" -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null
  )" || return 1
  [[ "$candidate_major" =~ ^[0-9]+$ ]] || return 1
  (( candidate_major >= 22 ))
}

if [[ -n "${HARNESS_NODE_BINARY:-}" ]] && \
  compatible_node "$HARNESS_NODE_BINARY"; then
  NODE_BINARY="$HARNESS_NODE_BINARY"
elif command -v node >/dev/null 2>&1 && \
  compatible_node "$(command -v node)"; then
  NODE_BINARY="$(command -v node)"
elif [[ -n "${HOME:-}" ]]; then
  NODE_BINARY=""
  for codex_node_candidate in \
    "$HOME"/.cache/codex-runtimes/*/dependencies/node/bin/node; do
    if compatible_node "$codex_node_candidate"; then
      NODE_BINARY="$codex_node_candidate"
      break
    fi
  done
  if [[ -z "$NODE_BINARY" ]]; then
    echo "Node.js 22 or newer is required to validate a release bundle." >&2
    exit 1
  fi
else
  echo "Node.js 22 or newer is required to validate a release bundle." >&2
  exit 1
fi
NODE_BINARY="$("$NODE_BINARY" -p 'require("node:fs").realpathSync(process.execPath)')"
NODE_MAJOR="$("$NODE_BINARY" -p 'Number(process.versions.node.split(".")[0])')"
if (( NODE_MAJOR < 22 )); then
  echo "Node.js 22 or newer is required; found $("$NODE_BINARY" --version)." >&2
  exit 1
fi

VALIDATION_DIRECTORY="$(
  mktemp -d "${TMPDIR:-/tmp}/delta-coinbase-guard-cold-install.XXXXXX"
)"
ADVISOR_PID=""
cleanup() {
  if [[ -n "$ADVISOR_PID" ]]; then
    kill "$ADVISOR_PID" 2>/dev/null || true
    wait "$ADVISOR_PID" 2>/dev/null || true
  fi
  rm -rf -- "$VALIDATION_DIRECTORY"
}
trap cleanup EXIT HUP INT TERM

ARCHIVE_LIST="$VALIDATION_DIRECTORY/archive-list.txt"
unzip -Z1 "$ARCHIVE_PATH" > "$ARCHIVE_LIST"
while IFS= read -r archive_path; do
  case "$archive_path" in
    ""|/*|../*|*/../*|*/..|*\\* )
      echo "Release archive contains an unsafe path: $archive_path" >&2
      exit 1
      ;;
  esac
done < "$ARCHIVE_LIST"

TOP_LEVEL="$(
  awk -F/ 'NF > 0 && length($1) > 0 { print $1 }' "$ARCHIVE_LIST" |
    sort -u
)"
if [[ -z "$TOP_LEVEL" ]] || [[ "$TOP_LEVEL" == *$'\n'* ]]; then
  echo "Release archive must contain exactly one top-level directory." >&2
  exit 1
fi

unzip -q "$ARCHIVE_PATH" -d "$VALIDATION_DIRECTORY/extracted"
RELEASE_ROOT="$VALIDATION_DIRECTORY/extracted/$TOP_LEVEL"
if [[ ! -d "$RELEASE_ROOT" ]]; then
  echo "Release archive did not extract to the expected root." >&2
  exit 1
fi
RELEASE_ROOT="$(cd "$RELEASE_ROOT" && pwd -P)"
if find "$RELEASE_ROOT" -type l -print -quit | grep -q .; then
  echo "Release archive must not contain symlinks." >&2
  exit 1
fi

PACKAGE_VERSION="$(
  "$NODE_BINARY" -e \
    'const p = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); process.stdout.write(String(p.version ?? ""));' \
    "$RELEASE_ROOT/package.json"
)"
EXPECTED_ROOT="delta-coinbase-guard-v$PACKAGE_VERSION"
if [[ "$TOP_LEVEL" != "$EXPECTED_ROOT" ]]; then
  echo "Archive root $TOP_LEVEL does not match package version $PACKAGE_VERSION." >&2
  exit 1
fi
if [[ "$(basename "$ARCHIVE_PATH")" != "$EXPECTED_ROOT.zip" ]]; then
  echo "Archive filename does not match package version: $(basename "$ARCHIVE_PATH")" >&2
  exit 1
fi

"$NODE_BINARY" "$RELEASE_ROOT/scripts/validate-release-metadata.mjs" \
  "$RELEASE_ROOT"
"$NODE_BINARY" "$RELEASE_ROOT/scripts/validate-skill.mjs" \
  "$RELEASE_ROOT"
"$NODE_BINARY" "$RELEASE_ROOT/scripts/check-local-links.mjs" \
  "$RELEASE_ROOT"

COLD_HOME="$VALIDATION_DIRECTORY/home"
CODEX_RUNTIME_NODE="$COLD_HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
mkdir -p "$(dirname "$CODEX_RUNTIME_NODE")"
ln -s "$NODE_BINARY" "$CODEX_RUNTIME_NODE"
INSTALL_OUTPUT="$(
  env -i \
    HOME="$COLD_HOME" \
    PATH="/usr/bin:/bin" \
    "$RELEASE_ROOT/install"
)"
printf '%s\n' "$INSTALL_OUTPUT" |
  grep -Fq "Installed Delta Coinbase Guard"
printf '%s\n' "$INSTALL_OUTPUT" |
  grep -Fq "Installation complete."

INSTALLED_SKILL="$COLD_HOME/.agents/skills/delta-coinbase-guard"
if [[ ! -L "$INSTALLED_SKILL" ]]; then
  echo "Cold install did not create the expected skill symlink." >&2
  exit 1
fi
MANAGED_HARNESS="$COLD_HOME/.local/share/delta/coinbase-guard/versions/v$PACKAGE_VERSION"
if [[ ! -d "$MANAGED_HARNESS" ]] || [[ -L "$MANAGED_HARNESS" ]]; then
  echo "Cold install did not create the expected managed version." >&2
  exit 1
fi
RESOLVED_INSTALLED_SKILL="$(cd -P "$INSTALLED_SKILL" && pwd -P)"
RESOLVED_MANAGED_SKILL="$(
  cd -P "$MANAGED_HARNESS/skills/delta-coinbase-guard" && pwd -P
)"
if [[ "$RESOLVED_INSTALLED_SKILL" != "$RESOLVED_MANAGED_SKILL" ]]; then
  echo "Installed skill does not resolve inside the managed version." >&2
  exit 1
fi
if [[ ! -f "$MANAGED_HARNESS/.delta-coinbase-guard-install.json" ]] || \
  [[ -L "$MANAGED_HARNESS/.delta-coinbase-guard-install.json" ]]; then
  echo "Managed install marker is missing or unsafe." >&2
  exit 1
fi

rm -rf -- "$RELEASE_ROOT"
if [[ -e "$RELEASE_ROOT" || -L "$RELEASE_ROOT" ]]; then
  echo "Extracted release could not be removed for post-install validation." >&2
  exit 1
fi

ADVISOR_STDOUT="$VALIDATION_DIRECTORY/advisor.stdout"
ADVISOR_STDERR="$VALIDATION_DIRECTORY/advisor.stderr"
env -i \
  HOME="$COLD_HOME" \
  PATH="/usr/bin:/bin" \
  DELTA_COINBASE_ADVISOR_PORT=0 \
  "$MANAGED_HARNESS/run" advisor \
  >"$ADVISOR_STDOUT" 2>"$ADVISOR_STDERR" &
ADVISOR_PID=$!

ADVISOR_URL=""
for (( advisor_attempt = 0; advisor_attempt < 100; advisor_attempt += 1 )); do
  if ! kill -0 "$ADVISOR_PID" 2>/dev/null; then
    echo "Cold-installed Advisor exited before becoming ready." >&2
    sed -n '1,80p' "$ADVISOR_STDERR" >&2
    exit 1
  fi
  ADVISOR_URL="$(
    "$NODE_BINARY" -e '
      const fs = require("node:fs");
      const text = fs.readFileSync(process.argv[1], "utf8");
      const match = text.match(/^Delta Guard Advisor: (http:\/\/127\.0\.0\.1:\d+)$/m);
      process.stdout.write(match?.[1] ?? "");
    ' "$ADVISOR_STDOUT"
  )"
  if [[ -n "$ADVISOR_URL" ]]; then
    break
  fi
  sleep 0.05
done
if [[ -z "$ADVISOR_URL" ]]; then
  echo "Cold-installed Advisor did not report a loopback URL." >&2
  sed -n '1,80p' "$ADVISOR_STDERR" >&2
  exit 1
fi

"$NODE_BINARY" -e '
  const base = new URL(process.argv[1]);
  const request = async (pathname, options = {}) => {
    const response = await fetch(new URL(pathname, base), {
      ...options,
      redirect: "error",
      signal: AbortSignal.timeout(2_000),
      headers: {
        "Sec-Fetch-Site": "same-origin",
        ...(options.headers ?? {}),
      },
    });
    if (response.headers.has("set-cookie")) {
      throw new Error(`${pathname} unexpectedly set a cookie`);
    }
    return response;
  };
  const assertSecurityHeaders = (response, pathname) => {
    if (response.headers.get("cache-control") !== "no-store") {
      throw new Error(`${pathname} is not non-cacheable`);
    }
    const csp = response.headers.get("content-security-policy") ?? "";
    if (!csp.includes("default-src '\''self'\''") ||
        !csp.includes("frame-ancestors '\''none'\''")) {
      throw new Error(`${pathname} is missing the locked Content-Security-Policy`);
    }
    if (response.headers.get("x-content-type-options") !== "nosniff" ||
        response.headers.get("x-frame-options") !== "DENY") {
      throw new Error(`${pathname} is missing browser security headers`);
    }
  };
  const assetBodies = new Map();
  for (const [pathname, contentType] of [
    ["/", "text/html"],
    ["/app.js", "text/javascript"],
    ["/styles.css", "text/css"],
  ]) {
    const response = await request(pathname);
    if (response.status !== 200) {
      throw new Error(`${pathname} returned ${response.status}, expected 200`);
    }
    assertSecurityHeaders(response, pathname);
    if (!(response.headers.get("content-type") ?? "").startsWith(contentType)) {
      throw new Error(`${pathname} has the wrong content type`);
    }
    const body = await response.text();
    if (body.length === 0) throw new Error(`${pathname} is empty`);
    assetBodies.set(pathname, body);
  }
  if (/<(?:script|link|img)\b[^>]*(?:src|href)=["'\''](?:https?:)?\/\//i.test(
    assetBodies.get("/") ?? "",
  )) {
    throw new Error("Advisor HTML depends on an external asset");
  }
  if (/(?:\bimport\s*(?:\(|[^;"'\'']*\bfrom\s*)|\bfetch\s*\(|\bnew\s+(?:Worker|URL)\s*\()\s*["'\''](?:https?:)?\/\//i.test(
    assetBodies.get("/app.js") ?? "",
  )) {
    throw new Error("Advisor JavaScript depends on an external asset");
  }
  if (/(?:@import\s+(?:url\(\s*)?|url\(\s*)["'\'']?(?:https?:)?\/\//i.test(
    assetBodies.get("/styles.css") ?? "",
  )) {
    throw new Error("Advisor CSS depends on an external asset");
  }
  const statusResponse = await request("/api/status");
  if (statusResponse.status !== 200) {
    throw new Error(`/api/status returned ${statusResponse.status}`);
  }
  assertSecurityHeaders(statusResponse, "/api/status");
  const status = await statusResponse.json();
  if (status.ready !== true ||
      status.execution?.enabled !== false ||
      status.execution?.order_submitted !== false ||
      status.execution?.money_moved !== false ||
      status.capabilities?.live_create !== false) {
    throw new Error("Advisor status did not preserve the locked execution boundary");
  }
  for (const pathname of [
    "/api/execute",
    "/api/create",
    "/api/orders",
    "/api/submit",
    "/api/place",
    "/api/proxy",
    "/api/final-confirmation",
    "/api/final-review-challenge",
    "/api/grant",
    "/api/claim",
    "/api/live-readiness",
  ]) {
    const getResponse = await request(pathname);
    if (getResponse.status !== 404) {
      throw new Error(`${pathname} GET returned ${getResponse.status}, expected 404`);
    }
    const postResponse = await request(pathname, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": base.origin,
        "X-Delta-Advisor": "1",
      },
      body: "{}",
    });
    if (postResponse.status !== 404) {
      throw new Error(`${pathname} POST returned ${postResponse.status}, expected 404`);
    }
  }
' "$ADVISOR_URL"

kill "$ADVISOR_PID" 2>/dev/null || true
wait "$ADVISOR_PID" 2>/dev/null || true
ADVISOR_PID=""

DOCTOR_OUTPUT="$(
  env -i \
    HOME="$COLD_HOME" \
    PATH="/usr/bin:/bin" \
    "$INSTALLED_SKILL/scripts/run" doctor
)"
printf '%s\n' "$DOCTOR_OUTPUT" | grep -Fq "contracts and skill"
printf '%s\n' "$DOCTOR_OUTPUT" | grep -Fq "LOCKED"

SHOWCASE_OUTPUT="$(
  env -i \
    HOME="$COLD_HOME" \
    PATH="/usr/bin:/bin" \
    "$INSTALLED_SKILL/scripts/run" coinbase-demo --no-artifacts
)"
for expected_line in \
  "SIMULATION_ONLY" \
  "ATTEMPT_1=BLOCK->RETRY" \
  "ATTEMPT_2=PASS->EXECUTE" \
  "EXACT_PAYLOAD_MATCH=true" \
  "EVIDENCE_MATCH=true" \
  "COINBASE_CREATE_INVOKED=false"; do
  if ! printf '%s\n' "$SHOWCASE_OUTPUT" | grep -Fq "$expected_line"; then
    echo "Cold-installed showcase is missing: $expected_line" >&2
    exit 1
  fi
done

validate_generic_simulation() {
  intent_file="$1"
  expected_side="$2"
  expected_size_field="$3"
  expected_market_reference="$4"
  expected_market_operator="$5"

  plan_output="$(
    env -i \
      HOME="$COLD_HOME" \
      PATH="/usr/bin:/bin" \
      "$INSTALLED_SKILL/scripts/run" plan \
      --intent-file "$MANAGED_HARNESS/$intent_file" \
      --compiler deterministic \
      --details
  )"
  printf '%s\n' "$plan_output" | grep -Fq "AWAITING_HUMAN_CONFIRMATION"
  plan_path="$(
    printf '%s\n' "$plan_output" |
      awk '/^Plan: / { sub(/^Plan: /, ""); print; exit }'
  )"
  policy_digest="$(
    printf '%s\n' "$plan_output" |
      awk '/^Policy digest: / { sub(/^Policy digest: /, ""); print; exit }'
  )"
  if [[ -z "$plan_path" || -z "$policy_digest" ]]; then
    echo "Cold-installed planner did not emit a plan path and policy digest." >&2
    exit 1
  fi

  simulation_output="$(
    env -i \
      HOME="$COLD_HOME" \
      PATH="/usr/bin:/bin" \
      "$INSTALLED_SKILL/scripts/run" preflight \
      --plan "$plan_path" \
      --confirm-policy "$policy_digest" \
      --details
  )"
  for expected_line in \
    "DRY RUN · SIMULATED FACTS · NO ORDER SUBMITTED" \
    "\"side\":\"$expected_side\"" \
    "\"field\":\"$expected_size_field\"" \
    "\"operator\":\"MAX\"" \
    "\"reference\":\"$expected_market_reference\"" \
    "\"operator\":\"$expected_market_operator\"" \
    "DELTA_DECISION=PASS" \
    "EXACT_PASS_GATE=true" \
    "SIMULATED_RESULT=EXECUTION_ELIGIBLE" \
    "ONE_TIME_GATE_CONSUMED=true" \
    "COINBASE_CREATE_INVOKED=false" \
    "COINBASE_CONTACTED=false" \
    "PRODUCTION_DELTA_INVOKED=false"; do
    if ! printf '%s\n' "$simulation_output" | grep -Fq "$expected_line"; then
      echo "Cold-installed $expected_side simulation is missing: $expected_line" >&2
      exit 1
    fi
  done
}

validate_generic_simulation \
  "examples/conditional-buy-intent.txt" \
  "BUY" \
  "quote_size" \
  "BEST_ASK" \
  "AT_OR_BELOW"
validate_generic_simulation \
  "examples/conditional-sell-intent.txt" \
  "SELL" \
  "base_size" \
  "BEST_BID" \
  "AT_OR_ABOVE"

printf 'Release bundle cold-install validation passed: %s (Node %s, restricted PATH, Advisor UI/API).\n' \
  "$(basename "$ARCHIVE_PATH")" \
  "$("$NODE_BINARY" --version)"
