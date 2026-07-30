import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  unlink,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { digest } from "./evidence.js";
import { GUARD_MODES } from "./guard-receipt.js";
import { STATE_DIR } from "./paths.js";

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;
const HISTORY_RETENTION = 100;
const NONCE_CLAIM_SCHEMA = "delta.coinbase.nonce_claim.v1";
const NONCE_RESULT_SCHEMA = "delta.coinbase.nonce_result.v1";

export const HISTORY_DIR = path.join(STATE_DIR, "history");

function assertPrivatePath(info, { directory = false } = {}) {
  if (
    info.isSymbolicLink() ||
    (directory ? !info.isDirectory() : !info.isFile())
  ) {
    throw new Error(
      `Refusing unsafe dry-run history ${directory ? "directory" : "entry"}`,
    );
  }
  if (
    typeof process.getuid === "function" &&
    info.uid !== process.getuid()
  ) {
    throw new Error("Refusing dry-run history owned by another user");
  }
  const requiredMode = directory ? DIRECTORY_MODE : FILE_MODE;
  if ((info.mode & 0o777) !== requiredMode) {
    throw new Error(
      `Dry-run history ${directory ? "directory" : "entry"} permissions must be ${requiredMode.toString(8)}`,
    );
  }
}

async function ensurePrivateDirectory(directory) {
  try {
    const info = await lstat(directory);
    assertPrivatePath(info, { directory: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await mkdir(directory, { recursive: true, mode: DIRECTORY_MODE });
    assertPrivatePath(await lstat(directory), { directory: true });
  }
}

function ageMs(timestamp, now) {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed)
    ? Math.max(0, now.getTime() - parsed)
    : null;
}

function policySummary(policy) {
  if (!policy) return null;
  return {
    product_id: policy.product_id,
    side: policy.side,
    size: policy.size,
    market_condition: policy.market_condition ?? null,
    max_slippage_bps: policy.limits?.max_slippage_bps ?? null,
    max_commission: policy.limits?.max_commission ?? null,
    settlement: policy.limits?.settlement ?? null,
    max_executions: policy.usage?.max_executions ?? null,
  };
}

export function createHistoryEntry(
  record,
  receipt,
  { now = new Date(), semanticDigest = null } = {},
) {
  if (!Object.values(GUARD_MODES).includes(receipt?.mode)) {
    throw new Error("History requires a typed guard receipt mode");
  }
  const evidenceObservedAt =
    record?.preview?.collected_at ??
    record?.market?.observed_at ??
    record?.generated_at ??
    null;
  const entry = {
    schema_version: "delta.coinbase.dry_run_history.v1",
    history_id: randomUUID(),
    recorded_at: now.toISOString(),
    mode: receipt.mode,
    input: {
      source_intent_digest: record?.source_intent_digest ?? null,
      policy_digest: record?.policy_digest ?? null,
      mandate: policySummary(record?.policy),
    },
    proposal: {
      proposal_digest: record?.proposal?.proposal_digest ?? null,
      product_id: record?.proposal?.action?.product_id ?? null,
      side: record?.proposal?.action?.side ?? null,
      quote_size: record?.proposal?.action?.quote_size ?? null,
      base_size: record?.proposal?.action?.base_size ?? null,
      limit_price: record?.proposal?.action?.limit_price ?? null,
    },
    outcome: receipt.decision.outcome,
    reason_code: receipt.decision.code,
    reason: receipt.decision.reason,
    provenance: receipt.provenance.source,
    evidence: {
      observed_at: evidenceObservedAt,
      age_ms:
        evidenceObservedAt == null ? null : ageMs(evidenceObservedAt, now),
      fingerprint: receipt.bindings.preflight_fingerprint,
    },
    boundary: {
      no_order_submitted: true,
      create_available: false,
      money_moved: false,
    },
    recovery: receipt.decision.recovery,
    receipt: {
      schema_version: receipt.schema_version,
      receipt_id: receipt.receipt_id,
      receipt_digest: receipt.receipt_digest,
      nonce_digest: receipt.nonce_digest,
      expires_at: receipt.expires_at,
      decision: receipt.decision.outcome,
    },
    semantic_digest:
      semanticDigest ?? receipt.bindings.authorization_digest,
    supersession_scope_digest: digest({
      mode: receipt.mode,
      source_intent_digest: record?.source_intent_digest ?? null,
      policy_digest: record?.policy_digest ?? null,
      confirmation_matched:
        record?.confirmation?.matched === true,
      credential_binding: record?.credential_binding ?? null,
    }),
    supersedes_receipt_digest: null,
  };
  return { ...entry, entry_digest: digest(entry) };
}

async function historyFiles(directory) {
  try {
    return (await readdir(directory))
      .filter((name) =>
        /^\d{8}T\d{9}Z-[a-f0-9-]{36}\.json$/.test(name),
      )
      .sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export async function writeHistoryEntry(
  entry,
  { directory = HISTORY_DIR } = {},
) {
  await ensurePrivateDirectory(directory);
  const previous = await readHistory({
    limit: HISTORY_RETENTION,
    directory,
  });
  const superseded = previous.find(
    (candidate) =>
      candidate.supersession_scope_digest ===
        entry.supersession_scope_digest &&
      candidate.evidence?.fingerprint !== entry.evidence?.fingerprint,
  );
  const nextEntry = superseded
    ? {
        ...entry,
        supersedes_receipt_digest:
          superseded.receipt?.receipt_digest ?? null,
      }
    : entry;
  const {
    entry_digest: _oldDigest,
    ...nextPayload
  } = nextEntry;
  const persistedEntry = {
    ...nextPayload,
    entry_digest: digest(nextPayload),
  };
  const timestamp = persistedEntry.recorded_at
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(".", "");
  const filePath = path.join(
    directory,
    `${timestamp}-${persistedEntry.history_id}.json`,
  );
  let handle;
  try {
    handle = await open(
      filePath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
      FILE_MODE,
    );
    await handle.writeFile(`${JSON.stringify(persistedEntry, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle?.close();
  }
  await chmod(filePath, FILE_MODE);

  const files = await historyFiles(directory);
  const overflow = files.slice(0, Math.max(0, files.length - HISTORY_RETENTION));
  for (const name of overflow) {
    const expiredEntry = await readPrivateJson(path.join(directory, name));
    await unlink(path.join(directory, name));
    const nonceDigest = expiredEntry?.receipt?.nonce_digest;
    if (/^[a-f0-9]{64}$/.test(nonceDigest ?? "")) {
      const paths = noncePaths(directory, nonceDigest);
      await unlink(paths.claim).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
      await unlink(paths.result).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
    }
  }
  return { filePath, entry: persistedEntry };
}

async function readPrivateJson(filePath) {
  const info = await lstat(filePath);
  assertPrivatePath(info);
  if (info.size > 256 * 1024) {
    throw new Error("Dry-run history entry exceeded the safety limit");
  }
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function readHistory(
  { limit = DEFAULT_LIMIT, directory = HISTORY_DIR, now = new Date() } = {},
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error(`History limit must be between 1 and ${MAX_LIMIT}`);
  }
  try {
    await ensurePrivateDirectory(directory);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = (await historyFiles(directory)).slice(-limit).reverse();
  const entries = [];
  for (const name of files) {
    const filePath = path.join(directory, name);
    const entry = await readPrivateJson(filePath);
    const { entry_digest: suppliedDigest, ...payload } = entry;
    if (
      entry.schema_version !== "delta.coinbase.dry_run_history.v1" ||
      digest(payload) !== suppliedDigest
    ) {
      throw new Error("Dry-run history integrity check failed");
    }
    entries.push(entry);
  }
  return entries.map((entry, index) => {
    const expiresAt = Date.parse(entry.receipt?.expires_at);
    const superseded =
      entries.some(
        (candidate) =>
          candidate.supersedes_receipt_digest ===
          entry.receipt?.receipt_digest,
      ) ||
      entries
        .slice(0, index)
        .some(
          (candidate) =>
            candidate.supersession_scope_digest ===
              entry.supersession_scope_digest &&
            candidate.evidence?.fingerprint !==
              entry.evidence?.fingerprint,
        );
    const currentStatus = superseded
      ? "SUPERSEDED"
      : !Number.isFinite(expiresAt) ||
          !Number.isFinite(now.getTime()) ||
          now.getTime() >= expiresAt
        ? "EXPIRED"
        : entry.outcome === "PASS"
          ? "CURRENT"
          : "HISTORICAL_ONLY";
    return { ...entry, current_status: currentStatus };
  });
}

export async function clearHistory({ directory = HISTORY_DIR } = {}) {
  await ensurePrivateDirectory(directory);
  const files = await readdir(directory);
  let deleted = 0;
  for (const name of files) {
    const historyEntry =
      /^\d{8}T\d{9}Z-[a-f0-9-]{36}\.json$/.test(name);
    const nonceArtifact =
      /^nonce-[a-f0-9]{64}\.(claim|result)\.json$/.test(name);
    if (historyEntry || nonceArtifact) {
      await unlink(path.join(directory, name));
      if (historyEntry) deleted += 1;
    }
  }
  return deleted;
}

export function findNonceHistory(entries, nonce) {
  const nonceDigest = digest(nonce);
  return entries.find(
    (entry) => entry.receipt?.nonce_digest === nonceDigest,
  );
}

export function assertReceiptActiveInHistory(
  receipt,
  entries,
  { now = new Date() } = {},
) {
  const expiresAt = Date.parse(receipt?.expires_at);
  if (
    !Number.isFinite(expiresAt) ||
    !Number.isFinite(now.getTime()) ||
    now.getTime() >= expiresAt
  ) {
    throw new Error(
      "Guard receipt has expired and is no longer current",
    );
  }
  const matching = entries.find(
    (entry) =>
      entry.receipt?.receipt_digest === receipt?.receipt_digest,
  );
  if (
    !matching ||
    matching.receipt?.nonce_digest !== receipt?.nonce_digest ||
    matching.receipt?.expires_at !== receipt?.expires_at
  ) {
    throw new Error("Guard receipt is not present in trusted local history");
  }
  const superseding = entries.find(
    (entry) =>
      entry.supersedes_receipt_digest === receipt?.receipt_digest,
  );
  const matchingIndex = entries.indexOf(matching);
  const newerExactEvidence = entries
    .slice(0, Math.max(0, matchingIndex))
    .find(
      (entry) =>
        entry.supersession_scope_digest ===
          matching.supersession_scope_digest &&
        entry.evidence?.fingerprint !== matching.evidence?.fingerprint,
    );
  if (superseding || newerExactEvidence) {
    throw new Error(
      "Guard receipt was superseded by a newer exact preflight and is no longer current",
    );
  }
  return true;
}

function noncePaths(directory, nonceDigest) {
  return {
    claim: path.join(directory, `nonce-${nonceDigest}.claim.json`),
    result: path.join(directory, `nonce-${nonceDigest}.result.json`),
  };
}

async function readNonceArtifact(filePath, schema) {
  const artifact = await readPrivateJson(filePath);
  const { artifact_digest: suppliedDigest, ...payload } = artifact;
  if (
    artifact.schema_version !== schema ||
    digest(payload) !== suppliedDigest
  ) {
    throw new Error("Nonce claim integrity check failed");
  }
  return artifact;
}

async function readNonceResultPath(filePath) {
  try {
    return await readNonceArtifact(filePath, NONCE_RESULT_SCHEMA);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function claimNonce(
  nonce,
  semanticDigest,
  { directory = HISTORY_DIR, now = new Date() } = {},
) {
  if (
    typeof nonce !== "string" ||
    nonce.length < 8 ||
    nonce.length > 256 ||
    !/^[a-f0-9]{64}$/.test(semanticDigest)
  ) {
    throw new Error("Nonce claim inputs are invalid");
  }
  await ensurePrivateDirectory(directory);
  const nonceDigest = digest(nonce);
  const paths = noncePaths(directory, nonceDigest);
  const completed = await readNonceResultPath(paths.result);
  if (completed) {
    return {
      status:
        completed.semantic_digest === semanticDigest
          ? "COMPLETED"
          : "MISMATCH",
      nonce_digest: nonceDigest,
      result: completed,
    };
  }
  const payload = {
    schema_version: NONCE_CLAIM_SCHEMA,
    nonce_digest: nonceDigest,
    semantic_digest: semanticDigest,
    claimed_at: now.toISOString(),
  };
  const claim = { ...payload, artifact_digest: digest(payload) };
  let handle;
  try {
    handle = await open(
      paths.claim,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
      FILE_MODE,
    );
    await handle.writeFile(`${JSON.stringify(claim, null, 2)}\n`);
    await handle.sync();
    await handle.close();
    handle = null;
    await chmod(paths.claim, FILE_MODE);
    return {
      status: "CLAIMED",
      nonce_digest: nonceDigest,
      claim,
    };
  } catch (error) {
    await handle?.close();
    if (error?.code !== "EEXIST") throw error;
    const existing = await readNonceArtifact(
      paths.claim,
      NONCE_CLAIM_SCHEMA,
    );
    return {
      status:
        existing.semantic_digest === semanticDigest
          ? "PENDING"
          : "MISMATCH",
      nonce_digest: nonceDigest,
      claim: existing,
    };
  }
}

export async function completeNonceClaim(
  nonce,
  semanticDigest,
  historyEntry,
  { directory = HISTORY_DIR, now = new Date() } = {},
) {
  await ensurePrivateDirectory(directory);
  const nonceDigest = digest(nonce);
  const paths = noncePaths(directory, nonceDigest);
  const claim = await readNonceArtifact(paths.claim, NONCE_CLAIM_SCHEMA);
  if (
    claim.nonce_digest !== nonceDigest ||
    claim.semantic_digest !== semanticDigest
  ) {
    throw new Error("Nonce result does not match its atomic claim");
  }
  const payload = {
    schema_version: NONCE_RESULT_SCHEMA,
    nonce_digest: nonceDigest,
    semantic_digest: semanticDigest,
    completed_at: now.toISOString(),
    history_id: historyEntry?.history_id ?? null,
    receipt_digest:
      historyEntry?.receipt?.receipt_digest ?? null,
  };
  const result = { ...payload, artifact_digest: digest(payload) };
  let handle;
  try {
    handle = await open(
      paths.result,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
      FILE_MODE,
    );
    await handle.writeFile(`${JSON.stringify(result, null, 2)}\n`);
    await handle.sync();
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await readNonceArtifact(
      paths.result,
      NONCE_RESULT_SCHEMA,
    );
    if (
      existing.semantic_digest !== semanticDigest ||
      existing.receipt_digest !== result.receipt_digest
    ) {
      throw new Error("Concurrent nonce result disagreed with the claim");
    }
    return existing;
  } finally {
    await handle?.close();
  }
  await chmod(paths.result, FILE_MODE);
  return result;
}

export async function waitForNonceResult(
  nonce,
  semanticDigest,
  {
    directory = HISTORY_DIR,
    timeoutMs = 5_000,
    pollMs = 25,
  } = {},
) {
  const paths = noncePaths(directory, digest(nonce));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const result = await readNonceResultPath(paths.result);
    if (result) {
      if (result.semantic_digest !== semanticDigest) {
        return { status: "MISMATCH", result };
      }
      return { status: "COMPLETED", result };
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return { status: "PENDING", result: null };
}
