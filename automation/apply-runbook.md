# Apply runbook — `pr-agent-poll` automation

The job definition in `pr-agent-poll.json` is the **documentation-of-record**:
OCE automations are Gateway-local cron jobs (persisted in the gateway's private
PVC state), not OCC resources and not agent Configuration — they are not
versioned by OCE deploys. If gateway state is ever rebuilt, recreate from this
file.

## Path 1 (verified) — ask the agent in chat

The mike agent holds the `automations` tool (`add` under caller scope;
live-verified 2026-11-19). Tell it:

> Create an automation named **pr-agent-poll**: run every 15 minutes, in an
> isolated session, with this prompt: <paste `payload.message` from
> pr-agent-poll.json>

The agent cannot create command payloads or event triggers (OCE blocks both)
— scheduled agent turns are exactly what we need.

Manage later by chat: "list automations", "pause pr-agent-poll",
"remove pr-agent-poll", or `wake` it to fire immediately.

## Path 2 — Control UI form

Open the agent's Control UI → **Automations** → **New automation**:

| Field | Value |
|---|---|
| Prompt | `payload.message` from pr-agent-poll.json |
| Action | Run agent task |
| Model / Reasoning | Default / low |
| Name | `pr-agent-poll` |
| Agent | `main` |
| Runs in | **Isolated session** (new session per run) |
| Repeat | Interval — every **15 Minutes** |

Note: the page banner says gateway configuration is read-only for managed
gateways. If the form refuses to save, use path 1 or 3.

## Path 3 — Gateway RPC (programmatic)

With the installation service key (never in argv — env or file):

```js
// GatewayClient from @openclaw/gateway-client, role "operator"
client.request("cron.add", { job: <pr-agent-poll.json contents> })
```

Endpoint: `wss://<host>/namespaces/<nsId>/agents/<agentId>`, service key as
`x-api-key` (see `docs/reference/gateway-routing.md` in openclaw-enterprise).

## Rollback / recreate

- Pause: ask the agent ("pause pr-agent-poll") or UI toggle.
- Remove: ask the agent ("remove pr-agent-poll") — receipts stay on GitHub.
- Recreate after gateway state loss: re-apply from this file (paths above).

## Field notes (verified against OCE sources 2026-11-19)

- `schedule.kind: "every"` + `everyMs` is the evidenced timed-trigger shape.
- `sessionTarget: "isolated"` → run session keys `agent:main:cron:<jobId>:run:<runId>`.
- `payload.kind: "agentTurn"` + `message` is the only supported payload in OCE.
- `toolsAllow` omitted intentionally → inherits the baseline tool allowlist
  (bash, sessions_spawn, …). Narrow it later if the tick proves itself.
- Model/reasoning per-job fields: the UI offers them; OCE tests don't evidence
  them — set via UI and verify effective behavior (M2 item).
