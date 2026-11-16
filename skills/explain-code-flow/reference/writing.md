# Choosing the level

One idea per line. A line says what happens, meaning what is different because this step ran. The identifier goes in the anchor or in the body.

## The line answers three questions

1. **What changes?** `charge the card` · `the Article is published` · `401`. The effect, in the voice of the flow.
2. **Who carries it over the boundary?** The store, the queue, the third party. The reader has to see that it left this process.
3. **When, or how often?** `daily at 5 AM` · `30 minutes later` · `loop over every scheduled Article`.

A spine of class names answers none of them. It is code with a diagram's indentation, and the reader has to translate every line before the flow exists.

## Write the effect, keep the nouns, demote the call

| write this                                        | not this                                            |
| ------------------------------------------------- | --------------------------------------------------- |
| `loop over every Draft linked to an Author`       | `Draft.find_each`                                   |
| `publish the Article record for that draft`       | `publish the article the Draft describes`           |
| `ask the CDN to purge the Article's URL`          | `Cdn::Purge.call`                                   |
| `~ the reindex job starts in 30 minutes`          | `ArticleReindexJob.set(wait: 30.minutes)`           |
| `runs daily at 5 AM`                              | `cron: "0 5 * * *"`                                 |
| `due → the Article goes live`                     | `due — the Article goes live`                       |
| `no match → build one`                            | `if no match, build one`                            |

**The nouns are vocabulary, not code.** `Article`, `Draft`, `Author`, `Feed` are names a developer already holds in their head. A line that avoids them buys nothing and costs the reader a translation. Keep the nouns, capitalised as the model is, and demote the call: `Article.from_draft(self, at:).save!` becomes `publish the Article record for that draft`, with the expression one level down under `@app/models/article.rb:351`.

The trap in this rule is describing an entity instead of naming it. `the article the draft describes` has a class name's length and none of its precision. If a line says _the thing that…_, name the thing.

**One name per entity, all document long.** Pick what the code calls it (`Author`) or what the customer calls it (`Writer`), then never mix. A reader who meets both spends the rest of the diagram wondering whether they are the same thing.

The identifier is not lost, it is demoted: `@app/services/…rb:12` on the line, the call itself in the accordion body. A reader who wants the code clicks it. A reader who wants the flow never has to. **Keep the anchor.** Every line that came from a file keeps one, because the anchor is what makes the document a map of the code instead of a description of it. A spine where half the lines point nowhere is prose with indentation.

## Keep it scannable

A line is scanned, not read. It fits one row of the render, or the reader is reading a paragraph that happens to be indented.

| where                               | budget                                 |
| ----------------------------------- | -------------------------------------- |
| a spine line or an accordion opener | under ~60 characters, one clause       |
| a `-` bullet inside a body          | under ~60 characters, one fact         |
| a `#` note                          | the only place a full sentence belongs |

The budget is what keeps arrows honest. `due → the Article goes live` is a line. `due, which means the Article goes live and every cache is purged` is the note that goes with it. When a line will not fit, the excess is detail that has not moved down a level: the reason becomes a `#` note, the mechanic becomes a body bullet.

Measure what wraps instead of guessing:

```bash
sed 's/@[^ ]*//' flow.lg | awk 'length > 62 {print NR": "length" chars"}'
```

A document where every line fits one row and every name is real reads in one pass.

## Detail follows the scope

The same rules produce two very different documents. The difference is how much the reader already asked to know.

| the flow is                                                                 | the reader wants                                             | so the chart                                                                                                         |
| --------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| **broad**: several services, HTTP hops, queues, a journey across the system | the shape, and where it can break                            | effect-level lines, a panel per crossing, nothing internal. One panel per step is detail nobody asked for.           |
| **narrow**: one job, one model, one path, two branches                      | the mechanics, because this is exactly what they asked about | a panel per step: the fields copied, the callbacks, the conditional, the retry, the edge case. Detail is the answer. |

A narrow flow drawn lightly fails the same way a broad flow drawn deeply does. One reader asked how a 30-line job works and got five labels. The other asked how checkout works and got the table names of four services. The first is a shrug, the second a transcript.

What does not change with scope: boundaries are always named (database, HTTP, async), and the branch that costs money or data is always drawn. What changes is everything _below_ them. At broad scope that is where you stop. At narrow scope that is where the answer lives.

At broad scope the detail budget buys three things: the crossing, the expensive branch, the exit.

## More than one trigger

Real work usually has three doors: the request, the save, the cron. A document per door gives the reader three files with a shared class name.

The spine follows the door the reader asked about. Every other trigger is a line of the same document, in the order it fires, and it says what fires it in words: `~ saving an Article schedules a reindex in 1 minute`, not `schedule_search_reindex`. A method name answers how the trigger is wired. The reader asks what makes this happen.

A second trigger that runs the same recovery over a wider set, like a cron sweeping 30 days of pending rows, earns a small block of its own: the loop, and one line pointing at the work already drawn. It must not earn a second copy of that work. Two identical panels read as two different mechanisms, and that is the one thing the reader needed to know was false.

## One marker, one line

`- ~ text` is not an async step. It is two markers fighting over one line, and the renderer resolves it in a way neither of them meant. A line starts with exactly one marker. The rest of the line is words.

## Shapes that carry meaning

- **A schedule belongs on the line.** `runs daily at 5 AM` · `30 minutes after each publish` · `every 6 hours`. If a cron or a delay decides when the work happens, a line that leaves it out describes a flow that never starts.
- **A loop is a word.** `loop over every scheduled Article, one at a time`. Nothing else marks repetition: not an indent, not a count, not a bullet. Name the work that repeats and the unit it repeats over.
- **Logic that fits in a line is an arrow.** `due → the Article goes live` · `3 days' drift → still matches` · `no match → build one`. Write `->` where the keyboard has no arrow.
- **Three crossings are never optional:** the database (which store, read or write), an HTTP call (who is on the other end), anything async (`~`, a queue, a delay). Demote names, not boundaries.

## Levels

The three levels are a choice of vocabulary, not a ladder:

| level    | the line reads like                             | use when                                                                |
| -------- | ----------------------------------------------- | ----------------------------------------------------------------------- |
| effect   | `reserve stock for the Cart`                    | the default. The flow can be followed without opening a file.           |
| boundary | `POST v3/checkout` · `Database.where(user_id:)` | the call _is_ the fact: an endpoint, a query, a topic.                  |
| concept  | `a new person signs up with company SSO`        | the flow is about people and no code name means anything to the reader. |

The default is effect. A document written at boundary level throughout is a call graph with pictures. One written at effect level keeps only the boundaries that matter, and keeps the nouns, which is what separates it from prose.

Mixing levels inside one document is fine. A spine that changes level halfway is not.

## Spine and accordion

| a plain line       | a `>` line                            |
| ------------------ | ------------------------------------- |
| the step           | how the step is implemented           |
| the decision       | the flag, the config key, the default |
| the event produced | topic, key, consumer groups           |
| the charge         | timeout, retry, idempotency key       |
| the failure        | exception class, status map           |

The `>` line is read while collapsed, so it carries the effect together with its boundary. Never a bare label, never a raw call: `> charge the card → Stripe` beats both `> what it does` and `> Stripe::Charge.create(amount:, source:)`. What it hides goes under it, indented one level, as plain text.

## Notes carry the reason

`#` answers why the line is shaped like this. Three things qualify:

- an invariant: `# one transaction, three writes, all or nothing`
- a measured number: `# p99 6.1ms on 200k rows`
- a gotcha: `# a retry must reuse the idempotency key`

Two `#` lines in a row are one note. Do not restate the step in a note.

## Boundaries are the content

Every crossing gets its own line: endpoint in, endpoint out, table written, topic produced, topic consumed, external service, user-visible effect.

A diagram with internal calls and no database write shows only the parts nobody was confused about.

An accordion body does not hide crossings. A query inside one keeps its store on the line: `Article.find_by(id:)` is a database read, and bare `find_by slug` hides one.

## Branches and limits

- Draw the one failure path that costs money or data. Not all of them, unless the flow is narrow, where the failure _is_ part of what was asked.
- `gate:` plus `yes:` / `no:` for a decision; `err:` for the typed failure. Both arms hold what _happens_, never a restatement of the condition above them. `err:` is a failure the code treats as one: a rescue, a status set to failed. The ordinary `no:` of a decision is not an error, even when it means the work waits.
- Over 15 spine lines: at broad scope that usually means internals crept in, so cut those first. Split into two documents only when the flow really is two stories, and say which one you drew.
- Accordion nesting: two levels. A third is prose, so put it in the body as text. An accordion is a leaf: a step that needs sub-steps stays a plain line, and its own facts become `#` notes.

## Verify before posting

```bash
grep -nE 'Database|produce|consume|http|Client' flow.lg   # every boundary from your source list appears
grep -nE '@[a-z/._-]+:[0-9]+' flow.lg                     # each anchor, opened with: nl -ba <path> | sed -n '<line>p'
grep -niE 'token|secret|password|api[_-]?key' flow.lg     # must print nothing
```

If an anchor's path or line does not match the source, delete the anchor. A wrong anchor opens the wrong file.
