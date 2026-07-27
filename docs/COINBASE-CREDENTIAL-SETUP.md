# Coinbase credential setup

This is the user-facing path for making Delta Coinbase Guard credential-ready.
Do not paste a Coinbase private key into chat, a prompt, an environment
variable, or this repository.

No credential is required for planning or the complete local Delta simulation.
The optional credential path enables authenticated Coinbase reads and Preview
only. Real Coinbase Create remains compile-time locked until the reviewed
production delta adapter and durable one-time grant store are installed.

## Public API availability

Verified against Coinbase's public documentation on 2026-07-27: the required
Advanced Trade endpoints are public and use ordinary user-created CDP API
credentials. No private Coinbase developer program is required for:

- [Get API Key Permissions](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/data-api/get-api-key-permissions);
- [Get Best Bid/Ask and the other Advanced Trade endpoints](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/rest-api);
- [Preview Order](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/orders/preview-orders); or
- [Create Order](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/orders/create-order).

Coinbase documents Preview as requiring `view`, Create as requiring `trade`,
and CDP keys as defaulting to their permissioned portfolio. A normal user can
[create an ECDSA CDP key](https://docs.cdp.coinbase.com/coinbase-app/authentication-authorization/api-key-authentication)
with portfolio and permission restrictions. The remaining missing capability
in this public build is not Coinbase access: it is the reviewed production
delta adapter, independent verification, and durable one-time execution grant.

## 1. Check readiness without a credential

```sh
./run credential-readiness
```

This reads no key and contacts no external service. It reports the required
scope, persistence boundary, non-overridable safety cap, and whether a prior
non-secret permission attestation exists.

## 2. Create a narrowly scoped Coinbase key

In Coinbase Developer Platform, create a new ECDSA/ES256 key dedicated to this
harness:

- enable **View** and **Trade**;
- disable **Transfer** and **Receive**;
- restrict it to the intended isolated portfolio;
- add the narrowest available IP restriction; and
- do not reuse a production or general-purpose key.

The first future live profile is hard-capped in source at one `ETH-USDC` BUY,
exactly `5.00 USDC` principal, `5.50 USDC` all-in, `0.50 USDC` maximum
commission, 50 bps slippage, IOC, and a 120-second authorization window.
Human authorization can narrow these limits but cannot broaden them.

## 3. Store the downloaded key outside the repository

Choose a permanent path outside this checkout and restrict the file:

```sh
chmod 600 /absolute/outside-repo/cdp_key.json
```

The guard rejects relative paths, symlinks, non-regular files, files owned by
another user, permissive file modes, oversized files, unknown JSON fields,
non-ECDSA keys, and any key stored inside the repository.

## 4. Validate and attest the configuration

Only after the user provides the key separately, run:

```sh
./run configure-credentials \
  --key-file /absolute/outside-repo/cdp_key.json
```

The command:

1. reads the key only from the supplied external path;
2. signs a request-bound, 120-second ES256 JWT for Coinbase's key-permissions
   endpoint;
3. rejects any key whose effective permissions are not exactly View+Trade with
   Transfer+Receive disabled; and
4. persists only a `0600` attestation containing permission booleans and
   one-way key/portfolio fingerprints under ignored `runtime/`.

It never prints or copies the key ID or private key. The key file path is not
persisted. Subsequent Preview commands require the path again at command time.

## 5. Keep execution locked

Credential configuration does not enable Coinbase Create. The public build
fails before reading credentials if `execute` or reconciliation is attempted
without the reviewed production composition. The later live path additionally
requires:

- an authenticated delta signer;
- terminal Orchestrator success;
- matching independent Verifier outcome and proof;
- exact Preview/Create payload binding;
- fresh market and Preview evidence;
- a transactionally consumed one-time execution grant; and
- both explicit real-money CLI acknowledgements.

Until those dependencies are installed in the compile-time composition seam,
the safe credentialed endpoint is `probe-execution`: authenticated reads,
Coinbase Preview, deterministic local checks, then stop.
