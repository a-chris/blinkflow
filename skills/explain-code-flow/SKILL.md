---
name: explain-code-flow
description: "Turns code into a Blinkflow flow diagram and returns one share link. Use to explain, trace or document how an endpoint, job, consumer or request works. Returns a link, never the diagram source."
when_to_use: "explain this code, how does this work, walk me through, trace this request, what happens when, document this flow, flow of this endpoint, explain the flow"
---

# Explain a code flow

Deliverable: one link.

## Procedure

1. Pick one flow — one request, one job, one topic, one command. If the user named one, use it. Otherwise ask which. Then decide its **scope**, because the scope decides how much each line may carry. **Broad** — several services, HTTP hops, queues, a journey across the system: the reader wants the shape, so stay at effect level and spend detail only on the crossings, the expensive branch and the exit. **Narrow** — one job, one model, one path: the reader asked about exactly this, so the mechanics are the answer — a panel per step, the conditionals named, the edge case included. A narrow flow drawn lightly and a broad flow drawn deeply are the same failure: neither is what was asked for.
2. Read the source. List, in order: the entry point — **and when it runs**, if anything schedules it — the decision that branches, **what repeats**, every contact point, the exit.
3. Write only calls you saw in the source. Do not infer a call.
4. Write what the line *does*, and only then what carries it. Every line answers "what is different because this happened?" — not "which method runs?".

| write this | not this |
|---|---|
| `loop over every BankAccount linked to a Team` | `BankAccount.find_each` |
| `create the Expense record for that occurrence` | `create the expense the Recurrence describes` |
| `ask the bank for the Team's transactions` | `BankAccounts::GetTransactions.call` |
| `~ the process job starts in 30 minutes` | `BankTransactionsProcessJob.set(wait: 30.minutes)` |
| `runs daily at 5 AM` | `cron: "0 5 * * *"` |
| `READY → the balance is saved` | `READY — the balance is saved` |

   - The identifier is not dropped, it is demoted: into the anchor (`@app/services/…rb:12`) or into the accordion body. A spine of class names is code with a diagram's indentation, and the reader has to translate every line before the flow exists.
   - **A line is scanned, not read.** Under ~60 characters, one clause. The reason goes in a `#` note, the mechanics in a `-` bullet one level down. A line that will not fit is detail that has not moved yet; a spine of full sentences is a wall of text with a tree drawn on top.
   - **Entities keep their names.** `Expense`, `Recurrence`, `Team`, `Sheet` are already plain English to whoever reads the code, so the line uses them as they are. What gets demoted is the call — `Expense.from_recurrence(self, date).save!` — never the noun.
   - Three things still get named on the line, because the reader would not guess them: **the database** (which store, read or write), **an HTTP call** (who is on the other end), and **anything async** (`~`, a queue, a delay). Meaning is not a licence to lose the boundary.
   - When the logic fits in one line, write it as an arrow: `no match → build one`, `3 days' drift → still matches`. `->` where the keyboard has no arrow.
   - A line that repeats says `loop`; a line that runs on a schedule says when — `daily at 5 AM`, `30 minutes after the sync`, `every 6 hours`. The language has no marker for either, so the word is the marker.
5. A step that carries implementation detail — a service, a command, a job — is written as an accordion: start the line with `>` instead of `-`, and the line itself is the accordion; the line says the effect, and the body holds the identifier, the numbers and the mechanics as one `-` fact each. The same spelling works as the first child of a step, where no sibling precedes it, and as the first line of a document when the flow starts with a block that is not a step — a transcript, a payload, a schema. Never write a plain step and hang its detail underneath: that draws two elements where the reader needs one. A step that needs sub-steps stays a plain line, and its own facts become `#` notes. A query inside an accordion still names its store — `Database.where(user_id:)`, `SELECT … FROM expenses`; a bare `find_by …` reads as an internal call and hides the database.
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
| job or queue | `~ CheckoutJob starts in 30 minutes` |
| cache | `read the cache: user:<id>, 23h` |
| third party | `charge the card → Stripe` |
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
sed 's/@[^ ]*//' flow.lg | awk 'length > 62 {print NR": "length" chars"}'   # wraps: the detail has not moved down yet
```

14. Write the link to a file, and hand over the file or the command that copies it:

```bash
python3 -c 'import json;print(json.load(open("/tmp/flow.json"))["links"]["simple"])' > /tmp/flow.url
wc -c < /tmp/flow.url        # 900–2000 characters: too long to retype, long enough to break once
```

    A payload is a compressed document. One dropped or swapped character does not look wrong — it decodes to nothing and the reader is told the link is damaged or from another version, which reads as your bug. So: copy the string out of the file, or reply with `pbcopy < /tmp/flow.url` (or the share dialog's short carrier) instead of the link itself. Never type it, never continue it by halves, and never reformat it across lines.
15. Reply with `"title"`, then the link or the command, then at most one sentence pointing at the part that matters.

## Worked example

Document — a Rails checkout, at the default level: the effect on the line, the identifier one level down.

```
# Checkout — one charge, one order

@user
POST v3/checkout
  gate: authenticated
    no:
      - 401 { error: "unauthenticated" }
    yes:
      > place the order: one transaction, three writes   @app/services/checkout/place.rb:14
        # the order exists only if all three land
        - Database.insert(order, line items, reserved stock)
      > charge the card → Stripe   @lib/stripe/charge.rb:9
        # the only irreversible step: a retry reuses the idempotency key
        - 900ms p99, 30s timeout, one retry
      > emit checkout.placed   @app/services/events/publish.rb:7
        - ~ Billing and Fulfilment consume it
      < 201 { id:, status: "confirmed" }
  err:
    - CardDeclined → 402 { error: "card_declined" }
```

Response:

```json
{"links":{"embedded":"https://blinkflow.live/c1.jFT…","simple":"https://blinkflow.live/#c1.jFT…"},
 "title":"Checkout — one charge, one order","steps":12,"arms":3,"panels":3,"notes":3}
```

Reply:

```
Checkout — one charge, one order

https://blinkflow.live/c1.jFT…
```

## Never

- print the Blinkflow document in the reply.
- retype or reconstruct the URL from memory: print it out of the response file. A stale link renders the old document, and nothing in the page reveals it.
- type a long link from memory, or finish one you started: a 1,000-character payload cannot be retyped by hand, and the failure is silent until the reader opens it.
- print the code you read, except a single line the user asked about.
- write an `@path:line` you did not open.
- put secrets, tokens, customer data or internal hostnames in the document: the document becomes a public URL.

## References

`reference/writing.md` choosing the level · `reference/syntax.md` the grammar · `examples/` the same flow at three levels.
