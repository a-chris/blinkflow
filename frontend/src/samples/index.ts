export interface Sample {
  id: string;
  name: string;
  doc: string;
}

const expenses = `# v3/expenses — API flow

@user
GET v3/expenses
  gate: permission expenses.read
    yes:
      > Services::GetExpenses.call(user_id)   @app/services/get_expenses.rb:12
        - AR query builder clamps per_page to 1..100, default 25
        - cursor = base64 of (created_at, id), so no offset pagination
        > Database.where(user_id:, cursor:, limit:)   @app/models/expense.rb:41
          # p50 1.2ms on prod, p99 6.1ms — measured 2025-11, 200k rows
          SELECT * FROM expenses
          WHERE user_id = $1
          ORDER BY created_at DESC, id DESC
          LIMIT 25
      err: StatementTimeout
        - 503 { error: "timeout", retry_after: 1 }
      ~ AuditLog.write(user_id:, action: "list")   @app/services/audit_log.rb:7
        # fire-and-forget: a failed audit never fails the read
      < 200 application/json
        > { data: [...], next_cursor: "eyJjcmVhdGVkX2F0IjoiLi4uIn0=" }
          the cursor is opaque: hand it straight back as ?cursor=
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
      err: CardDeclined
        ! PaymentRequired
      > Timeout
        charge stays :pending; the webhook settles it
      < :pending
    < 201 { order_id: order.id }
`;

const userFlow = `# Signup — user flow

@visitor
Landing page /
  visitor submits email
  gate: email already registered
    yes:
      > send magic link instead of password
        fewer support tickets, and no password reset flow to build
      - 202 { message: "check your inbox" }
    no:
      > create User(status: :pending)
        ~ VerificationMailer.deliver_later — signed token, 24h expiry
  gate: email verified within 24h
    yes:
      > onboarding checklist
        3 steps, skippable except the payment method
      - 302 /dashboard
    no:
      - 302 /verify-again
        > rate limited
          3 resends per hour per address
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
  { id: 'expenses', name: 'API flow — v3/expenses', doc: expenses },
  { id: 'call-stack', name: 'Call stack — POST /checkout', doc: callStack },
  { id: 'user-flow', name: 'User flow — signup', doc: userFlow },
];

export const DEFAULT_SAMPLE_ID = 'expenses';
