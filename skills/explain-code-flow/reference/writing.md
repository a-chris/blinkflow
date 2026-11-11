# Choosing the level

One line per idea. A line either names something the reader recognises, or it says nothing.

## Wording: first match wins

1. The real call reads as plain English → use it.
   `POST v3/checkout` · `GET /repos/:id/pulls` · `consume checkout.placed` · `Database.where(user_id:)`
2. The real call is opaque → write the intent with verbs and the payload.
   `reserve stock for the cart` · `charge the card` · `emit order.confirmed`
3. The flow is about people, not code → write the concept, no identifiers.
   `a new user signs up with company SSO`

Mixing levels inside one document is fine. A spine that changes level halfway is not.

## Spine and accordion

| a plain line | a `>` line |
|---|---|
| the step | how the step is implemented |
| the decision | the flag, the config key, the default |
| the event produced | topic, key, consumer groups |
| the charge | timeout, retry, idempotency key |
| the failure | exception class, status map |

The `>` line is read while collapsed, so it carries the thing itself — the call, the command, the block — never a label: `> Charge.create(amount:, source:)` beats `> what it does`. What it hides goes under it, indented one level, as plain text.

## Notes carry the reason

`#` answers "why is it shaped like this". Three things qualify:

- an invariant: `# one transaction, three writes, all or nothing`
- a measured number: `# p99 6.1ms on 200k rows`
- a gotcha: `# a retry must reuse the idempotency key`

Two `#` lines in a row are one note. Do not restate the step in a note.

## Boundaries are the content

Every crossing gets its own line: endpoint in, endpoint out, table written, topic produced, topic consumed, external service, user-visible effect.

A diagram with internal calls and no database write shows only the parts nobody was confused about.

An accordion body does not hide crossings. A query inside one keeps its store on the line: `Expense.find_by(id:)` is a database read; bare `find_by remote id` is an internal call that hides one.

## Branches and limits

- Draw the one failure path that costs money or data. Not all of them.
- `gate:` plus `yes:` / `no:` for a decision; `err:` for the typed failure.
- Over 15 spine lines: split into two documents and say which one you drew.
- Accordion nesting: two levels. A third is prose — put it in the body as text. An accordion is a leaf: a step that needs sub-steps stays a plain line, and its own facts become `#` notes.

## Verify before posting

```bash
grep -nE 'Database|produce|consume|http|Client' flow.lg   # every boundary from your source list appears
grep -nE '@[a-z/._-]+:[0-9]+' flow.lg                     # each anchor, opened with: nl -ba <path> | sed -n '<line>p'
grep -niE 'token|secret|password|api[_-]?key' flow.lg     # must print nothing
```

If an anchor's path or line does not match the source, delete the anchor. A wrong anchor opens the wrong file.
