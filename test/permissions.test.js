import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { assertViewOnlyPermissions, createRequestJwt } from "../src/permissions.js";

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
    /can_receive must be false/,
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
