import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import {
  chmod,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  assertTradeOnlyPermissions,
  assertViewOnlyPermissions,
  createRequestJwt,
  verifyTradeKeyFileAndConfigure,
  verifyViewKeyFileAndConfigure,
} from "../src/permissions.js";

test("view-only permissions pass and overscoped keys fail closed", () => {
  assert.equal(
    assertViewOnlyPermissions({
      can_view: true,
      can_trade: false,
      can_transfer: false,
      can_receive: false,
      portfolio_uuid: "11111111-1111-1111-1111-111111111111",
    }),
    true,
  );
  assert.equal(
    assertViewOnlyPermissions({
      can_view: true,
      can_trade: false,
      can_transfer: false,
      portfolio_uuid: "11111111-1111-1111-1111-111111111111",
    }),
    true,
  );
  assert.throws(
    () =>
      assertViewOnlyPermissions({
        can_view: true,
        can_trade: true,
        can_transfer: false,
        can_receive: false,
        portfolio_uuid: "11111111-1111-1111-1111-111111111111",
      }),
    /can_trade must be false/,
  );
  assert.throws(
    () =>
      assertViewOnlyPermissions({
        can_view: true,
        can_trade: false,
        can_transfer: false,
        can_receive: true,
        portfolio_uuid: "11111111-1111-1111-1111-111111111111",
      }),
    /can_receive must not be true/,
  );
});

test("trade execution requires exactly View+Trade and forbids money-movement permissions", () => {
  assert.equal(
    assertTradeOnlyPermissions({
      can_view: true,
      can_trade: true,
      can_transfer: false,
      can_receive: false,
      portfolio_uuid: "11111111-1111-1111-1111-111111111111",
    }),
    true,
  );
  assert.equal(
    assertTradeOnlyPermissions({
      can_view: true,
      can_trade: true,
      can_transfer: false,
      portfolio_uuid: "11111111-1111-1111-1111-111111111111",
    }),
    true,
  );
  assert.throws(
    () =>
      assertTradeOnlyPermissions({
        can_view: true,
        can_trade: true,
        can_transfer: true,
        can_receive: false,
        portfolio_uuid: "11111111-1111-1111-1111-111111111111",
      }),
    /can_transfer must be false/,
  );
});

test("request-bound ES256 JWT has the expected Coinbase claims and a valid signature", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pem = privateKey.export({ format: "pem", type: "sec1" }).toString();
  const token = createRequestJwt("organizations/test/apiKeys/test", pem);
  const [headerPart, payloadPart, signaturePart] = token.split(".");
  const header = JSON.parse(Buffer.from(headerPart, "base64url").toString());
  const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString());
  assert.equal(header.alg, "ES256");
  assert.equal(payload.iss, "cdp");
  assert.deepEqual(payload.uris, ["GET api.coinbase.com/api/v3/brokerage/key_permissions"]);
  assert.ok(signaturePart.length > 40);
  assert.equal(
    verify(
      "SHA256",
      Buffer.from(`${headerPart}.${payloadPart}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signaturePart, "base64url"),
    ),
    true,
  );
});

test("external credential file is permission-checked, read-only attested, and never persisted in tests", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "delta-coinbase-key-"));
  try {
    const { privateKey } = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    });
    const keyFile = path.join(temporary, "cdp_key.json");
    const keyJson = {
      name: "organizations/11111111-1111-1111-1111-111111111111/apiKeys/22222222-2222-2222-2222-222222222222",
      privateKey: privateKey.export({ format: "pem", type: "sec1" }).toString(),
    };
    await writeFile(keyFile, JSON.stringify(keyJson), { mode: 0o600 });
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          can_view: true,
          can_trade: true,
          can_transfer: false,
          can_receive: false,
          portfolio_uuid: "33333333-3333-3333-3333-333333333333",
        }),
    });
    const result = await verifyTradeKeyFileAndConfigure(keyFile, fetchImpl, {
      persistAttestation: false,
    });
    assert.equal(result.attestation.jwt_profile, "CDP_URIS_V1");
    assert.equal(result.attestation.can_trade, true);
    assert.equal(JSON.stringify(result.attestation).includes("PRIVATE KEY"), false);
    const viewResult = await verifyViewKeyFileAndConfigure(
      keyFile,
      async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            can_view: true,
            can_trade: false,
            can_transfer: false,
            can_receive: false,
            portfolio_uuid:
              "33333333-3333-3333-3333-333333333333",
          }),
      }),
      { persistAttestation: false },
    );
    assert.equal(viewResult.attestation.can_view, true);
    assert.equal(viewResult.attestation.can_trade, false);

    await chmod(keyFile, 0o644);
    await assert.rejects(
      () =>
        verifyTradeKeyFileAndConfigure(keyFile, fetchImpl, {
          persistAttestation: false,
        }),
      /permissions must be 0600/,
    );
    await chmod(keyFile, 0o600);
    const linkPath = path.join(temporary, "linked-key.json");
    await symlink(keyFile, linkPath);
    await assert.rejects(
      () =>
        verifyTradeKeyFileAndConfigure(linkPath, fetchImpl, {
          persistAttestation: false,
        }),
      /must not be a symlink/,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
