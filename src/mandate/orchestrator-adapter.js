import { canonicalize, digest } from "../evidence.js";
import { toDeltaWireAttributes } from "./coinbase-policy.js";

export const COINBASE_ACTION_LOCATOR_PREFIX =
  "coinbase-order://proposal/v1/";

function allowedBaseUrl(value, name) {
  if (typeof value !== "string" || !value) {
    throw new Error(`${name} is required`);
  }
  const url = new URL(value);
  const local =
    ["localhost", "127.0.0.1", "::1"].includes(url.hostname) &&
    url.protocol === "http:";
  if (url.protocol !== "https:" && !local) {
    throw new Error(`${name} must use HTTPS, except for loopback development`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must be an origin without credentials or query`);
  }
  return url.toString().replace(/\/$/, "");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalBearerToken(value, name) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be a nonempty string when provided`);
  }
  return value;
}

async function responseBody(response) {
  const text = await response.text();
  if (text.length > 512 * 1024) {
    throw new Error("Delta response exceeded the client size limit");
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class OrchestratorMandateAdapter {
  constructor({
    orchestratorUrl,
    verifierUrl,
    signer,
    actionRegistry,
    orchestratorBearerToken,
    verifierBearerToken,
    bearerToken,
    proofVerifier,
    verifierIdentity,
    proofProgramId,
    fetchImpl = fetch,
    timeoutMs = 20_000,
  }) {
    if (typeof signer?.signIntent !== "function") {
      throw new Error(
        "A Delta-native signer implementing signIntent() is required",
      );
    }
    if (typeof actionRegistry?.registerAction !== "function") {
      throw new Error(
        "A trusted action registry implementing registerAction() is required",
      );
    }
    if (typeof proofVerifier?.verifyProofArtifact !== "function") {
      throw new Error(
        "A cryptographic proof verifier implementing verifyProofArtifact() is required",
      );
    }
    if (typeof verifierIdentity !== "string" || !verifierIdentity) {
      throw new Error("A pinned verifierIdentity is required");
    }
    if (typeof proofProgramId !== "string" || !proofProgramId) {
      throw new Error("A pinned proofProgramId is required");
    }
    this.name = "delta-orchestrator-verifier";
    this.securityClass = "production-delta-mandate";
    this.orchestratorUrl = allowedBaseUrl(
      orchestratorUrl,
      "orchestratorUrl",
    );
    this.verifierUrl = allowedBaseUrl(verifierUrl, "verifierUrl");
    if (new URL(this.orchestratorUrl).origin === new URL(this.verifierUrl).origin) {
      throw new Error(
        "orchestratorUrl and verifierUrl must use distinct origins",
      );
    }
    if (bearerToken !== undefined) {
      throw new Error(
        "A shared bearerToken is not supported; use separate orchestratorBearerToken and verifierBearerToken values",
      );
    }
    this.signer = signer;
    this.actionRegistry = actionRegistry;
    this.proofVerifier = proofVerifier;
    this.verifierIdentity = verifierIdentity;
    this.proofProgramId = proofProgramId;
    this.orchestratorBearerToken = optionalBearerToken(
      orchestratorBearerToken,
      "orchestratorBearerToken",
    );
    this.verifierBearerToken = optionalBearerToken(
      verifierBearerToken,
      "verifierBearerToken",
    );
    if (
      this.orchestratorBearerToken &&
      this.verifierBearerToken &&
      this.orchestratorBearerToken === this.verifierBearerToken
    ) {
      throw new Error(
        "Orchestrator and Verifier bearer tokens must be distinct",
      );
    }
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async request(
    base,
    path,
    { method = "GET", body, contentType, allow404, bearerToken } = {},
  ) {
    const headers = { Accept: "application/json" };
    if (bearerToken) {
      headers.Authorization = `Bearer ${bearerToken}`;
    }
    if (contentType) headers["Content-Type"] = contentType;
    const response = await this.fetchImpl(`${base}${path}`, {
      method,
      headers,
      body,
      redirect: "error",
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const parsed = await responseBody(response);
    if (allow404 && response.status === 404) return null;
    if (!response.ok) {
      const message =
        (isPlainObject(parsed) && parsed.message) ||
        (typeof parsed === "string" && parsed) ||
        `HTTP ${response.status}`;
      throw new Error(`Delta request failed: ${message}`);
    }
    return parsed;
  }

  async submitPolicy(source) {
    const policyId = await this.request(this.orchestratorUrl, "/policies", {
      method: "POST",
      contentType: "text/plain",
      body: source,
      bearerToken: this.orchestratorBearerToken,
    });
    if (typeof policyId !== "string" || !policyId) {
      throw new Error("Delta policy submission returned an invalid policy ID");
    }
    return { policyId };
  }

  async authorizeIntent({ policyId, parameters, authorization }) {
    const signed = await this.signer.signIntent({
      policyId,
      parameters,
      authorization,
    });
    const intentId = signed?.intentId;
    const signedIntent = signed?.signedIntent;
    if (
      typeof intentId !== "string" ||
      !intentId ||
      signedIntent?.intent?.id !== intentId ||
      signedIntent?.intent?.policy_id !== policyId ||
      canonicalize(signedIntent?.intent?.attrs) !==
        canonicalize(toDeltaWireAttributes(parameters))
    ) {
      throw new Error("Delta signer returned an unbound signed intent");
    }
    await this.request(this.orchestratorUrl, "/intents", {
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify(signedIntent),
      bearerToken: this.orchestratorBearerToken,
    });
    return { intentId };
  }

  async prepareProposal({ actionRecord }) {
    if (
      !actionRecord ||
      typeof actionRecord !== "object" ||
      Array.isArray(actionRecord)
    ) {
      throw new Error("A frozen Coinbase action record is required");
    }
    const actionRecordDigest = digest(actionRecord);
    const registered = await this.actionRegistry.registerAction(actionRecord);
    const expectedSolution =
      `${COINBASE_ACTION_LOCATOR_PREFIX}${actionRecordDigest}`;
    if (
      !registered ||
      typeof registered !== "object" ||
      registered.action_record_digest !== actionRecordDigest ||
      registered.solution !== expectedSolution
    ) {
      throw new Error(
        "Trusted action registry did not return the content-addressed proposal solution",
      );
    }
    return {
      solution: registered.solution,
      actionRecordDigest,
    };
  }

  async submitProposal({ intentId, solution }) {
    await this.request(
      this.orchestratorUrl,
      `/intents/${encodeURIComponent(intentId)}/proposal`,
      {
        method: "POST",
        contentType: "application/json",
        body: JSON.stringify({ solution }),
        bearerToken: this.orchestratorBearerToken,
      },
    );
  }

  async getStatus({ intentId }) {
    return this.request(
      this.orchestratorUrl,
      `/intents/${encodeURIComponent(intentId)}/status`,
      { bearerToken: this.orchestratorBearerToken },
    );
  }

  async getVerificationOutcome({ intentId }) {
    return this.request(
      this.verifierUrl,
      `/intents/${encodeURIComponent(intentId)}`,
      {
        allow404: true,
        bearerToken: this.verifierBearerToken,
      },
    );
  }

  async getProof({ intentId }) {
    return this.request(
      this.verifierUrl,
      `/proofs/${encodeURIComponent(intentId)}`,
      {
        allow404: true,
        bearerToken: this.verifierBearerToken,
      },
    );
  }

  async verifyProofArtifact(input) {
    const result = await this.proofVerifier.verifyProofArtifact({
      ...input,
      verifierIdentity: this.verifierIdentity,
      proofProgramId: this.proofProgramId,
    });
    if (
      result?.verified !== true ||
      result.cryptographically_verified !== true ||
      result.verifier_identity !== this.verifierIdentity ||
      result.program_id !== this.proofProgramId ||
      result.proof_digest !== digest(input.proof)
    ) {
      throw new Error(
        "Pinned Delta proof verifier rejected or misbound the proof artifact",
      );
    }
    return result;
  }
}

export function createOrchestratorMandateAdapter(options) {
  return new OrchestratorMandateAdapter(options);
}
