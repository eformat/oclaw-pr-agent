#!/usr/bin/env node
// oce_register_credentials.mjs — M2: register the GitHub PAT Secret, the two
// bearer-token CredentialSources (github-web + github-api), grant the agent's
// service principal `operate` on them, bind all sources on the agent, deploy.
//
// Secrets NEVER appear in argv or output: the PAT is read from a protected
// file (default ~/.config/oclaw-pr-agent/github-pat); the OCC service key from
// OCC_SERVICE_KEY_FILE (JSON: {data:{key}} or {key}); only IDs are printed.
//
// Env:
//   OCC_URL               OCE API base URL (e.g. the openclaw-enterprise-console route)
//   NAMESPACE_ID          target namespace id (ns_…)
//   OCC_SERVICE_KEY_FILE  operator service-key JSON
//   AGENT_ID              agent id (agt_…) — omit to only create secret+sources
//   GITHUB_PAT_FILE       (optional) PAT file; default ~/.config/oclaw-pr-agent/github-pat
//   NAME_PREFIX           (optional) resource-name prefix; default "github".
//                         Use a NEW prefix for rotation (unique names), then rebind.
//   OCE_DRY_RUN           1 = print requests instead of sending (no auth needed)
//
// Usage: node scripts/oce_register_credentials.mjs
// Follows docs/reference/credential-sources.md + drivers/kubernetes-secret.md
// + drivers/openshell-credential-gateway.md in openclaw-enterprise.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DRY = process.env.OCE_DRY_RUN === "1";
const OCC_URL = process.env.OCC_URL ?? "";
const NS = process.env.NAMESPACE_ID ?? "";
const KEY_FILE = process.env.OCC_SERVICE_KEY_FILE ?? "";
const AGENT_ID = process.env.AGENT_ID ?? "";
const PAT_FILE = process.env.GITHUB_PAT_FILE
  ?? join(homedir(), ".config/oclaw-pr-agent/github-pat");
const P = process.env.NAME_PREFIX ?? "github";

for (const [k, v] of Object.entries({ OCC_URL, NAMESPACE_ID: NS })) {
  if (!v) { console.error(`missing env: ${k}`); process.exit(1); }
}

const pat = readFileSync(PAT_FILE, "utf8").replace(/\n$/, "");
if (!pat || pat.length < 20) { console.error(`no PAT in ${PAT_FILE}`); process.exit(1); }
let serviceKey = null;
if (!DRY) {
  try {
    const parsed = JSON.parse(readFileSync(KEY_FILE, "utf8"));
    serviceKey = parsed.data?.key ?? parsed.key;
  } catch {
    console.error(`cannot read OCC service key from OCC_SERVICE_KEY_FILE=${KEY_FILE} (expected JSON {data:{key}} or {key})`);
    process.exit(1);
  }
  if (!serviceKey) { console.error(`no key field in ${KEY_FILE}`); process.exit(1); }
}

const call = async (method, path, body) => {
  const url = new URL(`/namespaces/${encodeURIComponent(NS)}${path}`, OCC_URL);
  if (DRY) {
    const clone = structuredClone(body ?? {});
    if (clone.value) clone.value = "<redacted>";
    console.log(`[DRY] ${method} ${path}  ${JSON.stringify(clone)}`);
    return { __dry: true, id: `<dryrun:${path}>`, name: body?.name, ref: body?.value ? { kind: "secret", namespaceId: NS, id: `<dryrun:sec>` } : undefined, data: [] };
  }
  const response = await fetch(url, {
    method, redirect: "error",
    headers: body === undefined
      ? { "x-api-key": serviceKey }
      : { "x-api-key": serviceKey, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!(response.status === 200 || response.status === 201 || response.status === 202 || response.status === 204)) {
    const err = (await response.json().catch(() => null))?.error;
    throw new Error(`${method} ${path} -> HTTP ${response.status} ${err?.code ?? ""}: ${err?.message ?? ""}`);
  }
  const j = await response.json().catch(() => ({}));
  return j.data ?? j;
};

const list = async (path) => {
  if (DRY) return [];
  const j = await call("GET", path);
  return Array.isArray(j) ? j : (j.items ?? j.data ?? []);
};

// ---------- 1. Secret holding the PAT ----------
let secret = (await list("/secrets")).find((s) => s.name === `${P}-pat`);
if (secret) {
  console.log(`secret exists: ${secret.id} (${secret.name}) — reusing`);
} else {
  secret = await call("POST", "/secrets", { name: `${P}-pat`, value: pat });
  console.log(`secret created: ${secret.id} (${secret.name})`);
}
const tokenRef = secret.ref;

// ---------- 2. Two bearer-token CredentialSources (egress is per-destination) ----------
// NOTE: each source needs a DISTINCT env_var — two sources delivering to the
// same sandbox variable are refused (CREDENTIAL_SOURCE_ENVIRONMENT_CONFLICT).
// Destination-specific vars: git/https -> github.com uses $GITHUB_TOKEN_WEB;
// gh REST -> api.github.com uses $GITHUB_TOKEN_API (scripts pick per call).
const source = (name, host, envVar) => ({
  name, type: "bearer-token",
  // NOTE: omit `protocol` — a plain bearer-token tool credential must NOT set
  // it (setting it selects the managed-MCP validation branch and is refused).
  config: { env_var: envVar, host, port: "443", path: "/**" },
  secrets: { token: tokenRef },
});
const sources = [];
const wantSources = [
  [`${P}-web`, "github.com", "GITHUB_TOKEN_WEB"],
  [`${P}-api`, "api.github.com", "GITHUB_TOKEN_API"],
];
for (const [name, host, envVar] of wantSources) {
  let cs = (await list("/credential-sources")).find((s) => s.name === name);
  if (cs && process.env.OCE_RECREATE === "1") {
    await call("DELETE", `/credential-sources/${cs.id}`);
    console.log(`credential source deleted: ${cs.id} (${name}) — recreating`);
    cs = undefined;
  }
  if (cs) {
    console.log(`credential source exists: ${cs.id} (${name} -> ${host}) — reusing`);
  } else {
    cs = await call("POST", "/credential-sources", source(name, host, envVar));
    console.log(`credential source created: ${cs.id} (${name} -> ${host}, env ${envVar})`);
  }
  sources.push(cs);
}

// ---------- 3-5. Grant + bind + deploy (needs AGENT_ID) ----------
if (!AGENT_ID) {
  console.log("\nAGENT_ID not set — created secret + sources only. Re-run with AGENT_ID to grant, bind and deploy.");
} else {
  const sp = `service-agent-${AGENT_ID}`;

  // 3. role with credential_source:operate (reuse or create)
  let role = (await list("/iam/roles")).find(
    (r) => (r.permissions ?? []).some((p) => p.action === "operate" && p.resourceKind === "credential_source"),
  );
  if (role) {
    console.log(`role exists: ${role.id} (${role.name ?? "credential_source operate"}) — reusing`);
  } else {
    role = await call("POST", "/iam/roles", {
      name: `${P} credential source operate`,
      permissions: [{ action: "operate", resourceKind: "credential_source" }],
    });
    console.log(`role created: ${role.id}`);
  }

  // 4. access bindings: agent SP -> role -> each new source
  for (const cs of sources) {
    const bindings = await list("/iam/access-bindings");
    // stale bindings pointing at deleted sources of ours: clean up
    for (const b of bindings.filter((b) => b.resourceKind === "credential_source"
        && b.subjectId === sp && b.resourceId.startsWith("cs_")
        && !sources.some((s) => s.id === b.resourceId)
        && b.resourceId.includes(`${P}-`) === false && b.id.startsWith("binding_") )) {
      // no-op: only OUR prefix-named stale bindings are handled below
    }
    const existing = bindings.find(
      (b) => b.subjectId === sp && b.roleId === role.id && b.resourceKind === "credential_source" && b.resourceId === cs.id,
    );
    if (existing) {
      console.log(`binding exists: ${existing.id} (${sp} -> ${cs.id}) — reusing`);
    } else {
      const b = await call("POST", "/iam/access-bindings", {
        subjectKind: "identity", subjectId: sp, roleId: role.id,
        resourceKind: "credential_source", resourceId: cs.id,
      });
      console.log(`binding created: ${b.id} (${sp} -> ${cs.id})`);
    }
  }

  // 5. bind all sources on the agent (merge — keep existing bindings), deploy
  const agent = await call("GET", `/agents/${AGENT_ID}`);
  const existing = (agent.credentialSources ?? []).map((s) => s.sourceId);
  const merged = [...new Set([...existing, ...sources.map((s) => s.id)])]
    .map((sourceId) => ({ sourceId }));
  console.log(`agent credentialSources: ${existing.join(", ")} -> ${merged.map((s) => s.sourceId).join(", ")}`);
  if (DRY) {
    console.log(`[DRY] PATCH /agents/${AGENT_ID}  ${JSON.stringify({ configurationId: agent.configurationId, gatewayManagedMode: agent.gatewayManagedMode, credentialSources: merged })}`);
    console.log(`[DRY] POST /agents/${AGENT_ID}/deploy  {}`);
  } else {
    // live contract (running controller build) requires configurationId +
    // gatewayManagedMode in every agent PATCH
    await call("PATCH", `/agents/${AGENT_ID}`, {
      configurationId: agent.configurationId,
      gatewayManagedMode: agent.gatewayManagedMode,
      credentialSources: merged,
    });
    console.log(`agent updated (credentialSources merged; harnessAuth untouched)`);
    const rev = await call("POST", `/agents/${AGENT_ID}/deploy`, {});
    console.log(`deployed: revision ${rev.id ?? JSON.stringify(rev).slice(0, 80)}`);
  }
}

console.log("\nnext: OCE Console (or GET agent) to verify, then watch the gateway deploy the sources.");
