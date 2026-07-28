# Warm intro note

Hi — we have built a small Mastra reference around a specific problem with
agentic payments.

Mastra can make sure an agent sends a schema-valid payment request. Delta
checks the authorization question before that request reaches the payment
adapter: did this exact vendor, invoice, amount, account, bank destination and
timing match what the business approved?

The reference shows all three outcomes. `BLOCK` returns the failed constraints.
`REVIEW` persists a Mastra workflow snapshot and waits for an authenticated
decision. Only a trusted, exact `PASS` can consume a one-use execution grant.
The example uses a Brex-style vendor payment, but it is deliberately a local
simulation—not a claimed Brex integration.

Would you be open to a 30-minute code review with whoever owns Mastra tools and
workflows? We can bring the runnable package. The useful output would be a
cloneable Mastra example and a clear evidence contract for a later payment
sandbox conversation.

[Technical brief](./MASTRA-PARTNER-BRIEF.md) ·
[Browser-ready proof](../output/mastra/mastra-delta-partner-proof.html)
