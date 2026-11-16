---
name: explain-code-flow
description: "Turns code into a Blinkflow flow diagram and returns one share link. Use to explain, trace or document how an endpoint, job, consumer or request works. Returns a link, never the diagram source."
when_to_use: "explain this code, how does this work, walk me through, trace this request, what happens when, document this flow, flow of this endpoint, explain the flow"
---

# Explain a code flow

Deliverable: one link.

## The shape

```
# <what the flow does, in plain words>

<what starts it: @cron, @user, @web — bare, alone on the line>
~ <the job or the step> — <when it runs>   @path:line
  - <what it does, one clause, under 60 characters>   @path:line
    > <the step that carries the detail>   @path:line
      - <one fact>
      - <one fact>
  err:
    ! <what the failure leaves behind>
- <the next step>   @path:line
```

The first line is the title, and it is the only `#` at the left margin. One line, then the spine. No plan, no preamble, no second title: the card takes its title from that line, so anything you put above it becomes the headline.

The document follows the work, not the files. A file the work passes through is an `@path:line` on the line that touches it, never a heading. Three files are three anchors, not three sections.

Several things can start the same work: a cron, a save callback, a retry. The spine follows the one the reader asked about. Every other trigger gets a line of its own, in the order it fires, saying when. Never nest one trigger inside another, and two triggers that run the same work share one copy of it: the second is a line pointing at the first.

A trigger line says what fires it, in words. Write `~ saving an Article schedules a reindex in 1 minute`, not the method that does the scheduling.

```
@cron
~ PublishCronJob — daily at 4 AM   @config/initializers/good_job.rb:31
~ a saved Article runs the same publish, at once   @app/models/article.rb:75
  - loop over every scheduled Article   @app/jobs/publish_cron_job.rb:5
```

## The markers

A line that starts with none of these is code, and code goes in the anchor or in a body. One marker per line: `- ~ text` is not an async step, it is two markers with nothing to say.

| marker               | carries                                                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| `# text`             | the title, and the reasons. Hidden until asked.                                                     |
| `- text`             | a step                                                                                              |
| `> text`             | a step whose detail hides inside it                                                                 |
| `~ text`             | anything async, with its timing                                                                     |
| `@word` alone        | what starts the flow: `@web` an HTTP request, `@user` a person, `@cron` a schedule, `@model` a save |
| `…  @path:line`      | the source, at the end of a line. No anchor, no line.                                               |
| `gate:` `yes:` `no:` | a decision and its two arms                                                                         |
| `err:` then `!`      | the failure arm                                                                                     |
| `< text`             | what the caller gets back                                                                           |
| `→` `->`             | logic that fits in one clause: `due → the Article goes live`                                        |

## Decisions and failures

`gate:` is a question whose answers are `yes:` and `no:`. Each arm holds what happens, never a restatement of the condition, and neither arm is a failure:

```
  gate: the cache already has the rendered HTML
    yes:
      - the Article is served, status ready
    no:
      - status rendering_pending
```

`err:` is for what the code treats as a failure: a raise it rescues, a status it marks failed. The ordinary `no:` branch of a decision is not an `err:`.

## Crossings

A contact point gets a line of its own, and the line says which store, which side:

| crossing       | the line                                           |
| -------------- | -------------------------------------------------- |
| database read  | `Database.where(Article by status, publish_at)`    |
| database write | `Database.insert(Article)`, fields in the panel    |
| HTTP out       | `POST cdn.example.com/purge, /articles/*`          |
| HTTP in        | `POST v3/articles`                                 |
| async          | `~ SearchIndexRetryJob — in 1 minute`              |
| response       | `< 201 { id:, status: "published" }`               |

## Six rules

1. **Write only what a file you opened says.** Every wait, number and call on a line is a fact you read. The examples below show the kind of words a line uses. Their numbers are not facts about your flow.
2. **Write the effect, not the call.** `loop over every scheduled Article`, not `Article.find_each`. Keep the nouns: `Article` and `Author` are what the reader already reads. Demote the call to the anchor.
3. **Stay under 60 characters, one clause.** Past that the line is prose that has not moved down a level. The reason becomes a `#` note, the mechanics become a `-` bullet.
4. **Timing and repeats are words, taken from the source.** `0 4 * * *` is `daily at 4 AM`; `set(wait: 1.minute)` is `in 1 minute`. Every `.each` or `find_each` in a file you anchored keeps a `loop over every …` line: drop the loop and the steps under it read as if they happen once. A job started by another line is not an actor; it is `~` under the line that starts it.
5. **Name the boundaries.** The database, an HTTP call and who is on the other end, anything async. The rule holds inside a body: a `-` bullet says what happens, and the class name stays on the anchor. `0 */6 * * *` is never a line; that is `every 6 hours`.
6. **Keep the spine to about a dozen lines.** Past 15 you are drawing the call graph with a flow's indentation.

## Procedure

1. Read the entry point and every file it reaches. List, in order: the entry and when it runs, the branch, what repeats, each crossing, the exit.
2. Draw the spine from the shape above, one line per effect.
3. Anchor each line as you write it, only to files you opened.
4. Move the mechanics into `>` bodies until every line is under 60 characters.
5. Save it as `flow.lg`, run the Checks, and fix every line they print.
6. POST it:

```bash
curl -sS -o /tmp/flow.json -w '%{http_code}' -X POST https://blinkflow.live/share \
  -H 'content-type: text/plain' --data-binary @flow.lg
```

`--data-binary`, not `-d`: `-d` strips newlines, and newlines are the structure.

7. Read the status. On `400` the body is empty or the mode is wrong; on `413` the document is over the size limit. Report the status and the `error` field, then stop.
8. Write the link to a file, and hand over the file or the command that copies it:

```bash
python3 -c 'import json;print(json.load(open("/tmp/flow.json"))["links"]["simple"])' > /tmp/flow.url
wc -c < /tmp/flow.url        # 900–2000 characters: too long to retype, long enough to break once
```

    The payload is a compressed document. Drop or swap one character and nothing looks wrong: it decodes to nothing, and the reader is told the link is damaged or from another version, which reads as your bug. Copy the string out of the file, or reply with `pbcopy < /tmp/flow.url`. Never type it, never finish one by halves, never reformat it across lines.

9. Reply with the `"title"`, then the link or `pbcopy < /tmp/flow.url`, then at most one sentence pointing at the part that matters.

## Checks

Run these against `flow.lg`. What they print is what to fix. No output is a pass.

```bash
# code on a line, where the effect has not been written: a call, a block, a pseudocode
# `if x:` or `else:`. The word "if" inside a sentence is fine, the reader reads sentences.
# What must not appear is the line the code was copied from
grep -nE '^[[:space:]]*[-~>]' flow.lg | grep -E '(\.call\(|do \||\breturn\b|^[[:space:]]*[-~>] *if |\belsif\b|\belse:?$|\bend\b|[a-z_]+ = )'
# two markers on one line: neither one means anything after that
grep -nE '^[[:space:]]*[-~>!<][[:space:]]+[-~>!<][[:space:]]' flow.lg
# the title is the first line and the only one at the left margin: no plan, no preamble
grep -cE '^# ' flow.lg
# a trigger line written twice: the document is repeating itself
grep -E '^[[:space:]]*~' flow.lg | sort | uniq -d
# every loop in an anchored file (run from the repo root): each one needs a line that
# says it repeats. The loop lost most often is the one around the steps that follow
grep -oE '@[^ :]+' flow.lg | tr -d '@' | sort -u | sed 's/:.*//' | xargs grep -nE '\.(each|find_each)\b' 2>/dev/null
# an actor with arguments: an actor line is a bare @word, the schedule is words below it
grep -nE '^@[^[:space:]]*[^[:alnum:]._-]' flow.lg
# more spine lines than a flow has steps: the call graph is showing through
grep -cE '^[[:space:]]*[-~>]' flow.lg
# a number nobody can check: a top-level line with no anchor. In a body the panel's
# anchor carries it
grep -nE '^[[:space:]]{0,2}[-~>].*[0-9]+ *(ms|s|min|minutes|hours|seconds|%)' flow.lg | grep -v '@'
# past one row of text: detail that has not moved down a level
sed 's/@[^ ]*//' flow.lg | awk 'length > 62 {print NR": "length" chars"}'
```

A check that fails means a fresh attempt from the source, not a sentence added to the document.

## Worked example

Document — a Rails checkout: the effect on the line, the identifier one level down.

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
        - one request, retried on a timeout
      > emit checkout.placed   @app/services/events/publish.rb:7
        - ~ Billing and Fulfilment consume it
      < 201 { id:, status: "confirmed" }
  err:
    - CardDeclined → 402 { error: "card_declined" }
```

Response:

<!-- prettier-ignore -->
```json
{"links":{"embedded":"https://blinkflow.live/c1.jFT…","simple":"https://blinkflow.live/#c1.jFT…"},
 "title":"Checkout — one charge, one order","steps":12,"arms":3,"panels":3,"notes":3}
```

Reply:

```
Checkout — one charge, one order

https://blinkflow.live/c1.jFT…
```

Another shape, a cron that catches up. Real paths, so every line can be opened:

```
# A scheduled Article goes live

@cron
~ PublishCronJob — daily at 4 AM   @config/initializers/good_job.rb:31
  - loop over every Article past its publish_at   @app/jobs/publish_cron_job.rb:5
    # saving an Article runs this too
    > find the drafts that are due   @app/models/article.rb:177
      - every draft with publish_at in the past
      - skip the ones already published
    - loop over the due drafts   @app/models/article.rb:184
      > publish the Article   @app/models/article.rb:351
        - copy the Draft: body, tags, hero image
        - Database.insert
      > Article callbacks on save   @app/models/article.rb:98
        - body → rendered HTML, cached
        - other language → cached translation, or retry in 1 min
        - Tag count and monthly author stats move
        - RSS feed append, 30–60 min later
  err:
    ! reported and skipped → the next Article runs
```

## Never

- print the Blinkflow document in the reply.
- print a class, method or file that came from memory instead of from the source. An invented call and an invented number fail the same way: in the reader's head, after they trusted it.
- retype or reconstruct the URL from memory. Print it out of the response file. A stale link renders the old document and the page shows nothing wrong.
- type a long link from memory, or finish one you started. A 1,000-character payload cannot be retyped by hand, and the failure is silent until the reader opens it.
- print the code you read, except a single line the user asked about.
- write an `@path:line` you did not open.
- put secrets, tokens, customer data or internal hostnames in the document. The document becomes a public URL.

## References

`reference/writing.md` the scope budget and the wording table · `reference/syntax.md` the grammar · `examples/` the same flow at three levels.
