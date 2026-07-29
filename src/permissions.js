import { createHash, createPrivateKey, createSign, randomBytes } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { HARNESS_ROOT, RUNTIME_DIR } from "./paths.js";

const PERMISSIONS_URL = "https://api.coinbase.com/api/v3/brokerage/key_permissions";
const PERMISSIONS_PATH = "/api/v3/brokerage/key_permissions";
const EXECUTION_ENVIRONMENT_NAME = "live-delta-execution";
const ATTESTATION_DIR = path.join(RUNTIME_DIR, "attestations");
export const TRADE_ATTESTATION_PATH = path.join(
  ATTESTATION_DIR,
  "trade-permission-attestation.json",
);
export const VIEW_ATTESTATION_PATH = path.join(
  ATTESTATION_DIR,
  "view-permission-attestation.json",
);
export const JWT_PROFILE = "CDP_URIS_V1";

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
  if (!["GET", "POST"].includes(method)) {
    throw new Error("Coinbase JWT method must be GET or POST");
  }
  if (host !== "api.coinbase.com") {
    throw new Error("Coinbase JWT host must be api.coinbase.com");
  }
  if (
    typeof requestPath !== "string" ||
    !requestPath.startsWith("/api/v3/brokerage/") ||
    requestPath.includes("?") ||
    requestPath.includes("..")
  ) {
    throw new Error("Coinbase JWT path is invalid");
  }
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
  // The documented key-permissions response currently omits can_receive.
  // Reject an explicitly granted extension, but accept the documented shape.
  if (response?.can_receive === true) failures.push("can_receive must not be true");
  if (!response?.portfolio_uuid) failures.push("portfolio_uuid must be present");
  if (failures.length) {
    throw new Error(`Key is not safe for the preview harness: ${failures.join("; ")}`);
  }
  return true;
}

export function assertTradeOnlyPermissions(response) {
  const failures = [];
  if (response?.can_view !== true) failures.push("can_view must be true");
  if (response?.can_trade !== true) failures.push("can_trade must be true");
  if (response?.can_transfer !== false) failures.push("can_transfer must be false");
  if (response?.can_receive === true) failures.push("can_receive must not be true");
  if (!response?.portfolio_uuid) failures.push("portfolio_uuid must be present");
  if (failures.length) {
    throw new Error(`Key is not safe for the execution harness: ${failures.join("; ")}`);
  }
  return true;
}

async function readExternalKeyFile(keyFilePath) {
  if (typeof keyFilePath !== "string" || !path.isAbsolute(keyFilePath)) {
    throw new Error("CDP key path must be absolute");
  }
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  let handle;
  try {
    handle = await open(
      keyFilePath,
      fsConstants.O_RDONLY | noFollow,
    );
  } catch (error) {
    if (error?.code === "ELOOP") {
      throw new Error("CDP key file must not be a symlink");
    }
    throw error;
  }
  let raw;
  let resolvedPath;
  try {
    const fileInfo = await handle.stat();
    if (!fileInfo.isFile()) {
      throw new Error("CDP key path must be a regular file");
    }
    if (fileInfo.size <= 0 || fileInfo.size > 32 * 1024) {
      throw new Error("CDP key file size is outside the safety limit");
    }
    if ((fileInfo.mode & 0o077) !== 0) {
      throw new Error("CDP key file permissions must be 0600");
    }
    if (
      typeof process.getuid === "function" &&
      fileInfo.uid !== process.getuid()
    ) {
      throw new Error("CDP key file must be owned by the current user");
    }
    resolvedPath = await realpath(keyFilePath);
    const resolvedInfo = await stat(resolvedPath);
    if (
      resolvedInfo.dev !== fileInfo.dev ||
      resolvedInfo.ino !== fileInfo.ino
    ) {
      throw new Error("CDP key file changed while it was being verified");
    }
    const harnessRealPath = await realpath(HARNESS_ROOT);
    const relative = path.relative(harnessRealPath, resolvedPath);
    if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
      throw new Error("Keep the downloaded CDP key file outside this repository");
    }
    raw = await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("CDP key JSON must be an object");
  }
  const allowedFields = ["name", "privateKey", "id", "secret"];
  const unknownFields = Object.keys(parsed).filter(
    (field) => !allowedFields.includes(field),
  );
  if (unknownFields.length) {
    throw new Error(`CDP key JSON contains unknown fields: ${unknownFields.join(", ")}`);
  }
  const keyId = parsed.name ?? parsed.id;
  const privateKey = parsed.privateKey ?? parsed.secret;
  if (
    typeof keyId !== "string" ||
    !/^organizations\/[^/\s]+\/apiKeys\/[^/\s]+$/.test(keyId) ||
    typeof privateKey !== "string"
  ) {
    throw new Error("CDP key JSON must contain name/privateKey");
  }
  const parsedKey = createPrivateKey(privateKey);
  if (
    parsedKey.asymmetricKeyType !== "ec" ||
    parsedKey.asymmetricKeyDetails?.namedCurve !== "prime256v1"
  ) {
    throw new Error("This harness currently requires an ECDSA P-256 CDP key");
  }
  return { resolvedPath, keyId, privateKey };
}

async function persistPermissionAttestation(targetPath, attestation) {
  await mkdir(ATTESTATION_DIR, { recursive: true, mode: 0o700 });
  const directoryInfo = await lstat(ATTESTATION_DIR);
  if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) {
    throw new Error("Refusing unsafe credential-attestation directory");
  }
  await chmod(ATTESTATION_DIR, 0o700);
  try {
    const targetInfo = await lstat(targetPath);
    if (targetInfo.isSymbolicLink() || !targetInfo.isFile()) {
      throw new Error("Refusing unsafe credential-attestation target");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const temporaryPath = path.join(
    ATTESTATION_DIR,
    `.attestation-${process.pid}-${randomBytes(12).toString("hex")}.tmp`,
  );
  try {
    const temporary = await open(
      temporaryPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
      0o600,
    );
    try {
      await temporary.writeFile(`${JSON.stringify(attestation, null, 2)}\n`);
      await temporary.sync();
    } finally {
      await temporary.close();
    }
    await rename(temporaryPath, targetPath);
    await chmod(targetPath, 0o600);
  } finally {
    await unlink(temporaryPath).catch(() => {});
  }
}

async function fetchPermissions(keyId, privateKey, fetchImpl) {
  const jwt = createRequestJwt(keyId, privateKey);
  const response = await fetchImpl(PERMISSIONS_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Cache-Control": "no-cache",
      "Content-Type": "application/json",
    },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  const responseText = await response.text();
  if (responseText.length > 64 * 1024) {
    throw new Error("Coinbase permission response exceeded the safety limit");
  }
  if (!response.ok) {
    throw new Error(`Coinbase permission check failed with HTTP ${response.status}`);
  }
  return JSON.parse(responseText);
}

export async function verifyTradeKeyFileAndConfigure(
  keyFilePath,
  fetchImpl = fetch,
  { persistAttestation = true } = {},
) {
  const { keyId, privateKey } = await readExternalKeyFile(keyFilePath);
  const permissions = await fetchPermissions(keyId, privateKey, fetchImpl);
  assertTradeOnlyPermissions(permissions);

  const attestation = {
    schema: "delta.coinbase.trade_permission_attestation.v1",
    verified_at: new Date().toISOString(),
    environment: EXECUTION_ENVIRONMENT_NAME,
    jwt_profile: JWT_PROFILE,
    can_view: true,
    can_trade: true,
    can_transfer: false,
    can_receive: false,
    portfolio_fingerprint: createHash("sha256")
      .update(permissions.portfolio_uuid)
      .digest("hex"),
    key_fingerprint: createHash("sha256").update(keyId).digest("hex"),
  };
  if (persistAttestation) {
    await persistPermissionAttestation(
      TRADE_ATTESTATION_PATH,
      attestation,
    );
  }
  return {
    attestation,
    credentials: {
      keyId,
      privateKey,
    },
  };
}

export async function verifyViewKeyFileAndConfigure(
  keyFilePath,
  fetchImpl = fetch,
  { persistAttestation = true } = {},
) {
  const { keyId, privateKey } = await readExternalKeyFile(keyFilePath);
  const permissions = await fetchPermissions(keyId, privateKey, fetchImpl);
  assertViewOnlyPermissions(permissions);
  const attestation = {
    schema: "delta.coinbase.view_permission_attestation.v1",
    verified_at: new Date().toISOString(),
    environment: "coinbase-read-preview",
    jwt_profile: JWT_PROFILE,
    can_view: true,
    can_trade: false,
    can_transfer: false,
    can_receive: false,
    portfolio_fingerprint: createHash("sha256")
      .update(permissions.portfolio_uuid)
      .digest("hex"),
    key_fingerprint: createHash("sha256").update(keyId).digest("hex"),
  };
  if (persistAttestation) {
    await persistPermissionAttestation(
      VIEW_ATTESTATION_PATH,
      attestation,
    );
  }
  return {
    attestation,
    credentials: { keyId, privateKey },
  };
}

export async function loadAndVerifyTradeCredentials(keyFilePath, fetchImpl = fetch) {
  const result = await verifyTradeKeyFileAndConfigure(keyFilePath, fetchImpl);
  return {
    attestation: result.attestation,
    credentials: result.credentials,
  };
}

export async function loadAndVerifyViewCredentials(
  keyFilePath,
  fetchImpl = fetch,
) {
  const result = await verifyViewKeyFileAndConfigure(
    keyFilePath,
    fetchImpl,
  );
  return {
    attestation: result.attestation,
    credentials: result.credentials,
  };
}
