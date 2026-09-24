import type { PurchaseRequestRepository } from "../application/ports.ts";
import { DomainError } from "../domain/errors.ts";
import type { PurchaseRequest } from "../domain/purchase-request.ts";
import type {
  BusinessEvent,
  EventLog,
  NewBusinessEvent,
} from "../observability/business-events.ts";

/**
 * Stands in for a relational table. Values are cloned on the way in and out so
 * callers cannot mutate stored state without going through save().
 */
export class InMemoryPurchaseRequestRepository implements PurchaseRequestRepository {
  readonly #rows = new Map<string, PurchaseRequest>();

  get(id: string): PurchaseRequest | undefined {
    const row = this.#rows.get(id);
    return row ? structuredClone(row) : undefined;
  }

  save(request: PurchaseRequest): PurchaseRequest {
    const stored = this.#rows.get(request.id);
    const storedVersion = stored?.version ?? 0;
    if (stored && stored.version !== request.version) {
      throw new DomainError(
        "concurrent_modification",
        `Request ${request.id} changed since it was read (read v${request.version}, stored v${storedVersion}). Reload and retry.`,
      );
    }
    const next: PurchaseRequest = { ...request, version: storedVersion + 1 };
    this.#rows.set(next.id, structuredClone(next));
    return structuredClone(next);
  }

  dueForPosting(now: Date): readonly PurchaseRequest[] {
    return [...this.#rows.values()]
      .filter(
        (row) =>
          row.state === "approved" &&
          (row.erp.nextAttemptAt === null || Date.parse(row.erp.nextAttemptAt) <= now.getTime()),
      )
      .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt) || a.id.localeCompare(b.id))
      .map((row) => structuredClone(row));
  }
}

export class InMemoryEventLog implements EventLog {
  readonly #events: BusinessEvent[] = [];

  append(event: NewBusinessEvent): BusinessEvent {
    const stored = Object.freeze({ ...event, sequence: this.#events.length + 1 }) as BusinessEvent;
    this.#events.push(stored);
    return stored;
  }

  all(): readonly BusinessEvent[] {
    return [...this.#events];
  }

  forRequest(requestId: string): readonly BusinessEvent[] {
    return this.#events.filter((event) => event.requestId === requestId);
  }
}
