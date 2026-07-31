# Delta Guard Advisor v1.6 sprint log

This is an implementation and review record. Synthetic findings are labelled
and are not Coinbase, customer, partner, or market evidence.

## Sprint 0 — roadmap and foundation

### Product Manager requirements

Ship a protected execution copilot, not an autonomous broker: useful without a
credential, conversational first, editable mandate, explicit state machine,
and no loss of the v1.5.3 exact-payload/no-Create boundary.

### Engineering-lead architecture

Keep the dependency-free Node 22 ESM core. Add a same-origin loopback server
and static client; the browser handles presentation only. Reuse
`createExecutionPlan`, `runGuardPreflight`, receipts, and redacted history.
No `.openai/hosting.json` exists, so no Sites project is invented.

### Senior full-stack implementation

Added the versioned advisor capability contract and actionable roadmap,
design, and threat-model documents. Defined the eight-sprint state and
release journey before UI code.

### Backend and data

Active web plans and credentials will be in-memory. Existing redacted history
remains the only default persistence. Separate versioned conditional and
portfolio planning objects cannot become executable without creating and
authorizing a new one-action mandate.

### DevOps and release review

Local loopback is the credential-capable target. Hosted/static is
credential-free. The release must add the frontend to explicit archive and
managed-install allowlists, retain restricted-`PATH` validation, and keep
Create absent.

### Designer and frontend critique

Use one consultation workspace, four destinations, persistent trust strip,
conversation-dominant layout, calm warm-paper/deep-ink system, progressive
disclosure, and accessible decision semantics. Avoid dashboards, terminal
tropes, fake balances, and co-branding.

### QA

Established security, functional, browser, accessibility, responsive,
performance, install, and release gates. Highest-risk regression: a visible
Confirm control must never create an order route or imply a fill.

### Target-user qualitative feedback

Synthetic composite feedback only: a privacy-conscious spot user would try
the no-key dry run, identified the editable mandate as the trust moment, and
would connect only after a clear View-only permission test. They would reject
a hosted secret form or a conditional plan described as “active” without a
real monitor.

### Shipped impact

The team now has a single product, design, security, and release contract.
The existing v1.5.3 behavior is unchanged at this milestone.
