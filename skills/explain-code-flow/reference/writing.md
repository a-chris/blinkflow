# Choosing the level

One line per idea. A line says what happens — what is different because this step ran — and the identifier belongs to the anchor or to the body.

## The line answers three questions

1. **what changes?** `charge the card` · `the expense is saved` · `401` — the effect, in the voice of the flow.
2. **who carries it over the boundary?** the store, the queue, the third party: the reader has to see that it left this process.
3. **when, or how often?** `daily at 5 AM` · `30 minutes later` · `loop over every account`.

A spine of class names answers none of them. It is code with a diagram's indentation, and the reader has to translate every line before the flow exists.

## Write the effect, keep the nouns, demote the call

| write this | not this |
|---|---|
| `loop over every BankAccount linked to a Team` | `BankAccount.find_each` |
| `create the Expense record for that occurrence` | `create the expense the Recurrence describes` |
| `ask the bank for the Team's transactions` | `BankAccounts::GetTransactions.call` |
| `~ the process job starts in 30 minutes` | `BankTransactionsProcessJob.set(wait: 30.minutes)` |
| `runs daily at 5 AM` | `cron: "0 5 * * *"` |
| `READY → the balance is saved` | `READY — the balance is saved` |
| `no match → build one` | `if no match, build one` |

**The nouns are vocabulary, not code.** `Expense`, `Recurrence`, `Team`, `Sheet` are the names a developer already holds in their head; a line that avoids them buys nothing and costs the reader a translation. So the nouns stay, capitalised as the model is, and what gets demoted is the *call*: `Expense.from_recurrence(self, date).save!` becomes `create the Expense record for that occurrence`, with the expression one level down under `@app/models/expense.rb:351`.

The failure this rule invites, and the one to watch for, is describing an entity instead of naming it: `the expense the recurrence describes` has a class name's length and none of its precision. If a line says *the thing that…*, name the thing.

**One name per entity, all document long.** Pick what the code calls it (`Team`) or what the customer calls it (`Space`) — and then never mix. A reader who meets both in one diagram spends the rest of it wondering whether they are the same thing.

The identifier is not lost, it is demoted: `@app/services/…rb:12` on the line, the call itself in the accordion body. A reader who wants the code clicks it; a reader who wants the flow never has to. **Keep the anchor.** Every line that came from a file keeps one, because the anchor is what makes the document a map of the code instead of a description of it: a spine where half the lines point nowhere is prose with indentation.

## Keep it scannable

A line is scanned, not read. It fits one row of the render, or the reader is reading a paragraph that happens to be indented.

| where | budget |
|---|---|
| a spine line or an accordion opener | under ~60 characters, one clause |
| a `-` bullet inside a body | under ~60 characters, one fact |
| a `#` note | the only place a full sentence belongs |

The budget is what keeps the arrows honest. `READY → saved` is a line; `READY, which means the balance is saved and snapshotted` is the note that goes with it. When a line will not fit, the excess is detail that has not moved down a level yet: the reason becomes a `#` note, the mechanic becomes a body bullet, and the rest is the reader's time you were spending.

Measure what wraps instead of guessing:

```bash
sed 's/@[^ ]*//' flow.lg | awk 'length > 62 {print NR": "length" chars"}'
```

A document where every line is under 60 characters and every name is real reads in one pass. That is the whole product.

## Detail follows the scope

The same rules produce two very different documents, and the difference is not taste: it is how much the reader already asked to know.

| the flow is | the reader wants | so the chart |
|---|---|---|
| **broad** — several services, HTTP hops, queues, a journey across the system | the shape, and where it can break | effect-level lines, a panel per crossing, nothing internal. One panel per step is a wall of detail nobody asked for. |
| **narrow** — one job, one model, one path, two branches | the mechanics, because this is exactly what they asked about | a panel per step: the fields copied, the callbacks, the conditional, the retry, the edge case. Detail is the answer. |

A narrow flow drawn lightly fails the same way a broad flow drawn deeply does. The reader asked how a 30-line job works and got five labels, or asked how checkout works and got the table names of four services. The first is a shrug; the second is a transcript.

What does not change with scope: the boundaries are always named (database, HTTP, async), and the branch that costs money or data is always drawn. What changes is everything *below* them — at broad scope that is where you stop, at narrow scope that is where the answer lives.

At broad scope the detail budget buys three things only: the crossing, the expensive branch, the exit.

## Shapes that carry meaning

- **A schedule is a fact of the line.** `runs daily at 5 AM` · `30 minutes after each sync` · `every 6 hours`. If a cron or a delay decides when the work happens, a line that leaves it out describes a flow that never starts.
- **A loop is a word.** `loop over every bank account, one at a time`. Nothing else marks repetition — not an indent, not a count, not a bullet — so name the work that repeats and the unit it repeats over.
- **Logic that fits in a line is an arrow.** `READY → the balance is saved` · `3 days' drift → still matches` · `no match → build one`. Write `->` where the keyboard has no arrow.
- **Three crossings are never optional:** the database (which store, read or write), an HTTP call (who is on the other end), anything async (`~`, a queue, a delay). Demote names, not boundaries.

## Levels

The three levels are a choice of vocabulary, not a ladder:

| level | the line reads like | use when |
|---|---|---|
| effect | `reserve stock for the Cart` | the default. The flow can be followed without opening a file. |
| boundary | `POST v3/checkout` · `Database.where(user_id:)` | the call *is* the fact: an endpoint, a query, a topic. |
| concept | `a new person signs up with company SSO` | the flow is about people and no code name means anything to the reader. |

The default is effect. A document written at boundary level throughout is a call graph with pictures; one written at effect level keeps only the boundaries that matter — and keeps the nouns, which is what separates it from prose.

Mixing levels inside one document is fine. A spine that changes level halfway is not.

## Spine and accordion

| a plain line | a `>` line |
|---|---|
| the step | how the step is implemented |
| the decision | the flag, the config key, the default |
| the event produced | topic, key, consumer groups |
| the charge | timeout, retry, idempotency key |
| the failure | exception class, status map |

The `>` line is read while collapsed, so it carries the effect together with its boundary — never a bare label, never a raw call: `> charge the card → Stripe` beats both `> what it does` and `> Stripe::Charge.create(amount:, source:)`. What it hides goes under it, indented one level, as plain text.

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

- Draw the one failure path that costs money or data. Not all of them — unless the flow is narrow, where the failure *is* part of what was asked.
- `gate:` plus `yes:` / `no:` for a decision; `err:` for the typed failure.
- Over 15 spine lines: at broad scope that usually means internals crept in, so cut those first; split into two documents only when the flow really is two stories, and say which one you drew.
- Accordion nesting: two levels. A third is prose — put it in the body as text. An accordion is a leaf: a step that needs sub-steps stays a plain line, and its own facts become `#` notes.

## Verify before posting

```bash
grep -nE 'Database|produce|consume|http|Client' flow.lg   # every boundary from your source list appears
grep -nE '@[a-z/._-]+:[0-9]+' flow.lg                     # each anchor, opened with: nl -ba <path> | sed -n '<line>p'
grep -niE 'token|secret|password|api[_-]?key' flow.lg     # must print nothing
```

If an anchor's path or line does not match the source, delete the anchor. A wrong anchor opens the wrong file.
