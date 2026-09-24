import type { BusinessEvent } from "./business-events.ts";

export interface ValueSignals {
  readonly submitted: number;
  readonly approvedAutomatically: number;
  readonly approvedAfterReview: number;
  readonly rejected: number;
  readonly posted: number;
  /** Transient ERP failures that a later automatic retry absorbed. */
  readonly failuresAbsorbedByRetry: number;
  /** Retries where the ERP recognized the key instead of creating a duplicate. */
  readonly duplicatesPrevented: number;
  readonly exceptionsRaised: number;
  readonly exceptionsResolved: number;
}

/**
 * Derived only from the event log, so the numbers can always be traced back
 * to the individual requests that produced them.
 */
export function deriveValueSignals(events: readonly BusinessEvent[]): ValueSignals {
  const count = (predicate: (event: BusinessEvent) => boolean) => events.filter(predicate).length;

  const postedRequests = new Set(
    events
      .filter((event) => event.type === "erp.posting_succeeded")
      .map((event) => event.requestId),
  );

  return {
    submitted: count((event) => event.type === "request.submitted"),
    approvedAutomatically: count(
      (event) => event.type === "request.approved" && event.data.automatic,
    ),
    approvedAfterReview: count(
      (event) => event.type === "request.approved" && !event.data.automatic,
    ),
    rejected: count((event) => event.type === "request.rejected"),
    posted: postedRequests.size,
    failuresAbsorbedByRetry: count(
      (event) =>
        event.type === "erp.posting_failed" &&
        event.data.failure === "transient" &&
        event.data.nextAttemptAt !== null &&
        postedRequests.has(event.requestId),
    ),
    duplicatesPrevented: count(
      (event) => event.type === "erp.posting_succeeded" && event.data.replayed,
    ),
    exceptionsRaised: count((event) => event.type === "request.needs_attention"),
    exceptionsResolved: count((event) => event.type === "request.exception_resolved"),
  };
}
