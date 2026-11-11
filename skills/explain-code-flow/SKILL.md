---
name: explain-code-flow
description: "Turns code into a Blinkflow flow diagram and returns one share link. Use to explain, trace or document how an endpoint, job, consumer or request works. Returns a link, never the diagram source."
when_to_use: "explain this code, how does this work, walk me through, trace this request, what happens when, document this flow, flow of this endpoint, explain the flow"
---

# Explain a code flow

Deliverable: one link.

## Procedure

1. Pick one flow — one request, one job, one topic, one command. If the user named one, use it. Otherwise ask which.
2. Read the source. List, in order: the entry point, the decision that branches, every contact point, the exit.
3. Write only calls you saw in the source. Do not infer a call.
4. Write one idea per line. Choose wording by these rules, first match wins:
   - the real call reads as plain English → write the real call: `POST v3/checkout`, `consume checkout.placed`
   - the real call is opaque → write intent with verbs: `reserve stock for the cart`
   - the flow is about people, not code → write the concept: `a new user signs up with company SSO`
5. A step that carries implementation detail — a service, a command, a job — is written as an accordion: start the line with `>` instead of `-`, and the line itself is the accordion; list the facts one `-` bullet each inside. The same spelling works as the first child of a step, where no sibling precedes it, and as the first line of a document when the flow starts with a block that is not a step — a transcript, a payload, a schema. Never write a plain step and hang its detail underneath: that draws two elements where the reader needs one. A step that needs sub-steps stays a plain line, and its own facts become `#` notes. A query inside an accordion still names its store — `Expense.find_by(...)`, `SELECT … FROM expenses`; a bare `find_by …` reads as an internal call and hides the database.
6. Add a `#` note only for a reason: an invariant, a measured number, a gotcha.
7. Draw every contact point as its own line:

| crossing | line |
|---|---|
| HTTP in | `POST v3/checkout` |
| HTTP out | `GET inventory.internal/stock` |
| database read | `Database.where(user_id:, cursor:)` |
| database write | `Database.insert(order)` — list the writes in the accordion body |
| Kafka produce | `~ produce checkout.placed` |
| Kafka consume | `~ consume checkout.placed` as the entry point |
| job or queue | `~ CheckoutJob.perform_later(order.id)` |
| cache | `Cache.fetch("user:#{id}")` |
| third party | `Stripe::Charge.create(…)` |
| response | `< 201 { id:, status: "pending" }` |

8. Put an irreversible step in a note: a payment, an email, a delete, a published event.
9. Add `@path:line` only for a file and line you opened. If you did not open it, omit it.
10. Save the document as `flow.lg`.
11. POST it:

```bash
curl -sS -o /tmp/flow.json -w '%{http_code}' -X POST https://blinkflow.live/share \
  -H 'content-type: text/plain' --data-binary @flow.lg
```

`--data-binary`, not `-d`: `-d` strips newlines, and newlines are the structure.

12. Read the status. On `400` the body is empty or the mode is wrong; on `413` the document is over the size limit. Report the status and the `error` field, then stop.
13. On `200`, run these against `/tmp/flow.json`:

```bash
grep -o 'https://blinkflow\.live[^"]*' /tmp/flow.json | head -1   # the link; empty means something is wrong
grep -q '"panels":0' /tmp/flow.json && echo "nothing collapses — start the lines that carry detail with >"
grep -Eq '"title":"[^"]*[_:.#]' /tmp/flow.json && echo "bare identifier — rewrite line 1 in plain words"
```

14. Reply with `"title"`, then the URL the first command printed, then at most one sentence pointing at the part that matters.

## Worked example

Document — `examples/code-native.lg`, a Rails checkout:

```
# Checkout — one charge, one order

@user
POST v3/checkout
  gate: authenticated
    yes:
      > Checkout::Place.call(cart_id, user)   @app/services/checkout/place.rb:14
        # one transaction, three writes, all or nothing
        - Order.create!(status: "pending")
        - Stock.reserve!(cart.items)
      > Stripe::Charge.create(amount:, source:)   @lib/stripe/charge.rb:9
        # the only irreversible step
        - 900ms p99, 30s timeout, one retry
      < 201 { id:, status: "confirmed" }
```

Response:

```json
{"links":{"embedded":"https://blinkflow.live/c1.jFT…","simple":"https://blinkflow.live/#c1.jFT…"},
 "title":"Checkout — one charge, one order","steps":7,"arms":1,"panels":2,"notes":3}
```

Reply:

```
Checkout — one charge, one order

https://blinkflow.live/c1.jFT…
```

## Never

- print the Blinkflow document in the reply.
- retype or reconstruct the URL from memory: print it out of the response file. A stale link renders the old document, and nothing in the page reveals it.
- print the code you read, except a single line the user asked about.
- write an `@path:line` you did not open.
- put secrets, tokens, customer data or internal hostnames in the document: the document becomes a public URL.

## References

`reference/writing.md` choosing the level · `reference/syntax.md` the grammar · `examples/` the same flow at three levels.
