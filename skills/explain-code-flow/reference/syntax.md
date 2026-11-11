# Grammar

Spaces for indentation; a tab is an error. One node per line.

## Markers

| write | means |
|---|---|
| `text` or `- text` | step; an entry point needs no dash |
| `! text` | failure, raises |
| `~ text` | async: queued, produced, not awaited |
| `< text` | returns to the caller |
| `> text` | accordion — the line is the element and its detail hides inside (see Accordions) |
| `label: text` | arm, a labelled branch |
| `# text` | note attached to the node above |
| `@user` on its own line | actor |

## Arms

Reserved: `gate:` (condition), `yes:` / `no:` (its branches), `else:` (catch-all), `err:` (typed failure, `err: CardDeclined`).

Any other `label:` is free-form, read from position: under a `gate:` it matches a value; with no gate it is a path split (`new user:`); after a failing step it is an error arm. A label is a short identifier — letters, digits, spaces, hyphens. Over four words is a hint that it belongs in an accordion body.

## Accordions

A line that starts with `>` is an accordion: the line is the element, and its detail hides inside it.

```
> Database.where(user_id:)
  # p50 1.2ms, p99 6.1ms
  SELECT * FROM expenses
  WHERE user_id = $1
  LIMIT 25
```

A `>` is a component wherever you write it — opening a document, as the first child of a step, or as one more line in a sibling group. Its indent decides where it sits, exactly like any other line. It is never an aside hanging off the line above.

```
gate: authenticated
  yes:
    > Checkout::Place.call(cart_id, user)   @app/services/checkout/place.rb:14
      # one transaction, three writes, all or nothing
      - Order.create!(status: "pending")
      - Stock.reserve!(cart.items)
    < 201 { id:, status: "confirmed" }
```

A document can open with one, which is how a block that is not a step in the code — a transcript, a payload, a schema — gets drawn:

```
> shell transcript
  $ bundle exec rake db:migrate
  $ bundle exec rails s
```

- The `>` line is visible while closed, so it has to say what is inside. Put the call, the command or the block there.
- The body is deeper-indented raw text — SQL, stack traces, prose, bullets. Nothing in it is parsed. List discrete facts one `-` bullet each: `- 30s timeout`, `- one retry`.
- An accordion is a leaf: its body is text. A step that needs sub-steps stays a plain line, and its own facts become `#` notes:

  ```
  - Payments::Charge.call(order)   @app/services/payments/charge.rb:9
    # the 10s timeout is deliberate
    > WebhookReconciler.schedule(order.id)
      the webhook is the source of truth, not this response
  ```

- A `>` inside a body nests an accordion inside that body; with no detail of its own it is drawn as an annotation.
- A `>` with nothing under it has nothing to open: it is drawn as a plain line.
- In a body, a line starting with `>` is structure: write `\>` for a literal, `\#` for a literal `#`.

### Accordion or plain line?

Does the line carry detail of its own? If yes, write `>` and put the detail inside it. If no, write a plain line and let its children carry the detail. Never write a plain line and hang its detail underneath — that draws two elements where the reader needs one.

## Notes

`#` attaches to the nearest node above it at the same or a shallower indent. Consecutive `#` lines are one note; a bare `#` between them is a paragraph break. A `#` before any node describes the document and renders at the top.

## Anchors

```
- Payments::Charge.call(order)   @app/services/payments/charge.rb:9
```

A trailing `@path[:line[:col]]` links the node. The path must contain `/` or `.`, which is why `@user` stays an actor. Only anchor a file and line you opened.

## What the counts mean

`/share` counts:

- **steps** — every node line: steps, actors (`@user`), arms (`gate:`, `yes:`), `!`, `~`, `<`, and every `>` line. Arms are also counted in `arms`.
- **arms** — lines with a `label:`.
- **panels** — `>` openers, nested ones included, unless the line hides nothing. Body text is never counted.
- **notes** — `#` notes; consecutive lines are one.

## Validation

| severity | when |
|---|---|
| error | tab indentation |
| hint | `->` instead of `-`; a marker with no space (`-oops`); an arm label that reads like a sentence |

Errors do not blank the diagram: the parsable part renders.

## Complete document

```
# Checkout — one charge, one order

@user
POST v3/checkout
  gate: authenticated
    no:
      - 401 { error: "unauthenticated" }
    yes:
      > Checkout::Place.call(cart_id, user)   @app/services/checkout/place.rb:14
        # one transaction, three writes, all or nothing
        - Order.create!(status: "pending")
        - LineItem.bulk_insert(cart.items)
        - Stock.reserve!(cart.items)
      > Stripe::Charge.create(amount:, source:)   @lib/stripe/charge.rb:9
        # the only irreversible step
        - 900ms p99, 30s timeout, one retry
        - idempotency_key: order.id
      > Events.produce("checkout.placed", order.id)   @app/services/events/publish.rb:7
        ~ consumed by Billing and Fulfilment
      < 201 { id:, status: "confirmed" }
  err:
    - CardDeclined → 402 { error: "card_declined" }
```

That document POSTs to `/share` as 12 steps · 3 arms · 3 panels · 3 notes.

The full grammar with the reasoning behind each rule is `SPEC.md` in the Blinkflow repository.
