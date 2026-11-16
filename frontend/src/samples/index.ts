export interface Sample {
  id: string;
  name: string;
  doc: string;
}

// The samples are the pitch: the source runs long, the render runs short.
// Most of each document lives inside accordions, so the spine a reader sees
// is a fraction of the text — that ratio is the product.
const articles = `# v3/articles — API flow
# every number on this page was measured on prod, and each hides behind a >

@author
GET v3/articles
  gate: permission articles.read
    yes:
      > ListArticles.call(author_id)   @app/services/list_articles.rb:12
        # the query builder clamps per_page and keeps the cursor opaque
        - per_page clamped to 1..100, default 25
        - cursor = base64(published_at, id), never a page number
        > Database.where(author_id:, cursor:, limit:)   @app/models/article.rb:41
          # p50 1.2ms, p99 6.1ms — 200k rows, measured 2025-11
          SELECT id, slug, title, summary, published_at
          FROM articles
          WHERE author_id = $1
            AND (published_at, id) < ($2, $3)
          ORDER BY published_at DESC, id DESC
          LIMIT 26
          -- index: articles_author_published_idx covers WHERE and ORDER BY
          -- 26, not 25: the extra row says a next page exists, no COUNT(*)
          > why keyset, not OFFSET
            OFFSET drifts when an article lands mid-scan: page 2 would repeat it
            the cursor pins (published_at, id), so page 2 starts exactly after
            page 1's last row — stable under inserts
      err: StatementTimeout
        - 503 { error: "timeout", retry_after: 1 }
          > the Sentry fingerprint, for whoever is on call
            QueryCanceled: canceling statement due to statement timeout
            app/models/article.rb:41:in \`load_page'
            app/services/list_articles.rb:28:in \`call'
            app/controllers/articles_controller.rb:9:in \`block in index'
      ~ ImpressionLog.write(author_id:, action: "list")   @app/services/impression_log.rb:7
        # fire-and-forget: a dropped impression never fails the read
      < 200 application/json
        > { data: [...], next_cursor: "eyJwdWJsaXNoZWRfYXQiOi4uLiJ9" }
          the cursor is opaque: hand it straight back as ?cursor=
          X-RateLimit-Limit: 600/min per token, burst 100
    no:
      token expired:
        - 401 { error: "token_expired" }
      else:
        - 403 { error: "forbidden" }
          ! AuthorizationError
`;

const callStack = `# POST v3/checkout — call stack

POST v3/checkout   @app/controllers/checkout_controller.rb:18
  > authenticate!
    Current.user from the session cookie — 401 when absent
    # the session lives in Redis, 14-day sliding TTL
  - Checkout::Place.call(cart, user)   @app/services/checkout/place.rb:9
    # one transaction, 3 writes, 6 invariants
    # never call this outside a request
    > validate_cart   @app/services/checkout/place.rb:22
      cart non-empty · every item in stock · price snapshot < 15 min old
    ! EmptyCart
    ! InsufficientStock
    - Order.create!(...)   @app/services/checkout/place.rb:41
      < order
    - Payments::Charge.call(order)   @app/services/payments/charge.rb:9
      # the 10s timeout is deliberate: Stripe p99 spikes to 4s under load
      > WebhookReconciler.schedule(order.id)
        the Stripe webhook is the source of truth, not this response
        retries 3x with exponential backoff, idempotency key = order.id
        ~ after the 3rd failure a human gets the order, not a retry
      err: CardDeclined
        ! PaymentRequired
      > Timeout
        charge stays :pending; the webhook settles it
      < :pending
    < 201 { order_id: order.id }
      > the full body, for the curl-and-jq people
        { "order_id": 9182, "status": "confirmed",
          "receipt_url": "https://pay.example.com/r/9182" }
`;

const userFlow = `# Signup — user flow

@visitor
Landing page /
  visitor submits email
  gate: email already registered
    yes:
      > send a magic link, not a password prompt
        fewer support tickets, and no password reset flow to build
        # the link is signed, single-use, and lives 15 minutes
      - 202 { message: "check your inbox" }
    no:
      > create the account as pending
        ~ VerificationMailer.deliver_later — signed token, 24h expiry
        # the first person from a new email domain becomes that org's admin
  gate: email verified within 24h
    yes:
      - 302 /dashboard
        > the onboarding checklist
          3 steps, skippable except the payment method
          # step 2 is the activation metric the growth team watches
    no:
      - 302 /verify-again
        > rate limited
          3 resends per hour per address, then a support form
          # per address, not per IP — a shared office keeps working
  existing customer:
    - password login
      gate: 2FA enabled
        yes:
          - 302 /2fa
        no:
          - 302 /dashboard
  banned:
    - 403 { error: "account_suspended" }
`;

export const SAMPLES: readonly Sample[] = [
  { id: 'articles', name: 'API flow — v3/articles', doc: articles },
  { id: 'call-stack', name: 'Call stack — POST /checkout', doc: callStack },
  { id: 'user-flow', name: 'User flow — signup', doc: userFlow },
];

export const DEFAULT_SAMPLE_ID = 'articles';
