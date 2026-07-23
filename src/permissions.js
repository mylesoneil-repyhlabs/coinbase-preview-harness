import { createHash, createPrivateKey, createSign, randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { CONFIG_DIR, ENVIRONMENT_NAME, HARNESS_ROOT, runPinnedCli } from "./coinbase-cli.js";
import { sanitize } from "./sanitize.js";

const PERMISSIONS_URL = "https://api.coinbase.com/api/v3/brokerage/key_permissions";
const PERMISSIONS_PATH = "/api/v3/brokerage/key_permissions";
export const ATTESTATION_PATH = path.join(HARNESS_ROOT, "runtime", "permission-attestation.json");

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function encodeJson(value) {
  return base64url(JSON.stringify(value));
}

function toJoseSignature(derSignature) {
  let offset = 2;
  if (derSignature[offset] !== 0x02) throw new Error("Invalid ECDSA signature");
  offset += 1;
  const rLength = derSignature[offset];
  offset += 1;
  let r = derSignature.subarray(offset, offset + rLength);
  offset += rLength;
  if (derSignature[offset] !== 0x02) throw new Error("Invalid ECDSA signature");
  offset += 1;
  const sLength = derSignature[offset];
  offset += 1;
  let s = derSignature.subarray(offset, offset + sLength);

  const normalize = (part) => {
    while (part.length > 32 && part[0] === 0) part = part.subarray(1);
    if (part.length > 32) part = part.subarray(part.length - 32);
    if (part.length === 32) return Buffer.from(part);
    const output = Buffer.alloc(32);
    part.copy(output, 32 - part.length);
    return output;
  };

  return Buffer.concat([normalize(r), normalize(s)]);
}

export function createRequestJwt(keyId, privateKey, method = "GET", host = "api.coinbase.com", requestPath = PERMISSIONS_PATH) {
  if (!privateKey.includes("BEGIN EC PRIVATE KEY")) {
    throw new Error("Advanced Trade requires an ECDSA/ES256 CDP key");
  }
  createPrivateKey(privateKey);

  const now = Math.floor(Date.now() / 1_000);
  const header = {
    alg: "ES256",
    typ: "JWT",
    kid: keyId,
    nonce: randomBytes(16).toString("hex"),
  };
  const payload = {
    sub: keyId,
    iss: "cdp",
    nbf: now,
    iat: now,
    exp: now + 120,
    uris: [`${method} ${host}${requestPath}`],
  };
  const signingInput = `${encodeJson(header)}.${encodeJson(payload)}`;
  const signer = createSign("SHA256");
  signer.update(signingInput);
  const signature = signer.sign(privateKey);
  return `${signingInput}.${base64url(toJoseSignature(signature))}`;
}

export function assertViewOnlyPermissions(response) {
  const failures = [];
  if (response?.can_view !== true) failures.push("can_view must be true");
  if (response?.can_trade !== false) failures.push("can_trade must be false");
  if (response?.can_transfer !== false) failures.push("can_transfer must be false");
  if (response?.can_receive !== false) failures.push("can_receive must be false");
  if (!response?.portfolio_uuid) failures.push("portfolio_uuid must be present");
  if (failures.length) {
    throw new Error(`Key is not safe for the preview harness: ${failures.join("; ")}`);
  }
  return true;
}

export async function verifyKeyFileAndConfigure(keyFilePath, fetchImpl = fetch) {
  const resolvedPath = path.resolve(keyFilePath);
  const relative = path.relative(HARNESS_ROOT, resolvedPath);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
    throw new Error("Keep the downloaded CDP key file outside this repository");
  }

  const raw = await readFile(resolvedPath, "utf8");
  const parsed = JSON.parse(raw);
  const keyId = parsed.name ?? parsed.id;
  const privateKey = parsed.privateKey ?? parsed.secret;
  if (!keyId || !privateKey) {
    throw new Error("CDP key JSON must contain name/privateKey");
  }

  const jwt = createRequestJwt(keyId, privateKey);
  const response = await fetchImpl(PERMISSIONS_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(10_000),
  });

  const responseText = await response.text();
  if (responseText.length > 64 * 1024) {
    throw new Error("Coinbase permission response exceeded the safety limit");
  }
  if (!response.ok) {
    throw new Error(`Coinbase permission check failed with HTTP ${response.status}`);
  }
  const permissions = JSON.parse(responseText);
  assertViewOnlyPermissions(permissions);

  await runPinnedCli(["env", ENVIRONMENT_NAME, "--key-file", resolvedPath], { timeout: 30_000 });

  const attestation = {
    schema: "delta.coinbase.permission_attestation.v1",
    verified_at: new Date().toISOString(),
    environment: ENVIRONMENT_NAME,
    can_view: true,
    can_trade: false,
    can_transfer: false,
    can_receive: false,
    portfolio_fingerprint: createHash("sha256").update(permissions.portfolio_uuid).digest("hex"),
    key_fingerprint: createHash("sha256").update(keyId).digest("hex"),
  };
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await writeFile(ATTESTATION_PATH, `${JSON.stringify(attestation, null, 2)}\n`, { mode: 0o600 });

  return sanitize(attestation);
}

export async function loadPermissionAttestation() {
  const raw = await readFile(ATTESTATION_PATH, "utf8");
  const attestation = JSON.parse(raw);
  if (
    attestation.can_view !== true ||
    attestation.can_trade !== false ||
    attestation.can_transfer !== false ||
    attestation.can_receive !== false ||
    typeof attestation.portfolio_fingerprint !== "string"
  ) {
    throw new Error("Permission attestation is missing or unsafe; rerun credential configuration");
  }

  const config = JSON.parse(await readFile(path.join(CONFIG_DIR, "config.json"), "utf8"));
  const configuredKeyId = config?.environments?.[ENVIRONMENT_NAME]?.auth?.key_id;
  if (
    typeof configuredKeyId !== "string" ||
    createHash("sha256").update(configuredKeyId).digest("hex") !== attestation.key_fingerprint
  ) {
    throw new Error("Configured Coinbase key no longer matches the verified permission attestation");
  }
  return attestation;
}
