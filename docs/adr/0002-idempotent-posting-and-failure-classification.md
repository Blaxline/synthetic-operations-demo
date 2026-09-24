# ADR 0002: Idempotent posting and failure classification

- Status: Accepted
- Date: 2026-09-24

## Context

Posting a purchase order to the ERP crosses a network boundary. The ERP can fail before writing anything, fail after writing (a lost response), or refuse the order for a business reason. From the caller's side, the first two look identical.

## Decision

- Every attempt for the same request carries the same idempotency key. The ERP returns the original document for a key it has already accepted.
- Failures are classified before they are handled:
  - **Transient**: retried with capped exponential backoff, up to a fixed budget.
  - **Permanent**: sent straight to a person. Retrying cannot fix a missing vendor.
  - **Unknown**: treated as transient, because the outcome is ambiguous and the idempotency key makes a retry safe.
- When the retry budget is spent, the request moves to `needs_attention`. A person resolves it by retrying or cancelling, and that resolution is an audit event.
- Posting runs as a job over due requests, driven by an injected clock.

## Consequences

- A lost response never produces a duplicate purchase order.
- Humans only see failures that need judgment.
- Backoff has no jitter so that the demo and tests are deterministic. A deployment with many concurrent workers would add full jitter.
- The idempotency guarantee depends on the ERP honoring the key. Where a real ERP does not, the adapter must look up the order by an external reference before creating it.
