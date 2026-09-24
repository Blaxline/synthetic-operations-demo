import type { Cents } from "../domain/money.ts";
import type { Role, SpendCategory } from "../domain/purchase-request.ts";

/**
 * Business events describe what happened in the operation, not in the code.
 * They are the audit trail and the raw material for value signals. Technical
 * telemetry (traces, logs) would sit alongside them, correlated by request id.
 */
export interface EventPayloads {
  "request.submitted": {
    readonly amountCents: Cents;
    readonly category: SpendCategory;
    readonly vendorId: string;
    readonly vendorIsNew: boolean;
    readonly policyVersion: string;
    readonly requiredRoles: readonly Role[];
    readonly ruleIds: readonly string[];
  };
  "request.approval_recorded": { readonly role: Role };
  "request.approved": { readonly policyVersion: string; readonly automatic: boolean };
  "request.rejected": { readonly reason: string };
  "erp.posting_attempted": { readonly attempt: number; readonly idempotencyKey: string };
  "erp.posting_succeeded": {
    readonly attempt: number;
    readonly documentNumber: string;
    /** The ERP had already accepted this key: a retry that did not duplicate. */
    readonly replayed: boolean;
  };
  "erp.posting_failed": {
    readonly attempt: number;
    readonly failure: "transient" | "permanent";
    readonly message: string;
    readonly nextAttemptAt: string | null;
  };
  "request.needs_attention": { readonly reason: string };
  "request.exception_resolved": {
    readonly resolution: "retry" | "cancel";
    readonly note: string;
  };
}

export type EventType = keyof EventPayloads;

interface Envelope<K extends EventType> {
  readonly sequence: number;
  readonly type: K;
  readonly requestId: string;
  /** A person, or a "system:" identity for automated work. */
  readonly actorId: string;
  readonly occurredAt: string;
  readonly data: EventPayloads[K];
}

export type BusinessEvent = { [K in EventType]: Envelope<K> }[EventType];

export type NewBusinessEvent = { [K in EventType]: Omit<Envelope<K>, "sequence"> }[EventType];

/** Append-only. Events are never updated or deleted. */
export interface EventLog {
  append(event: NewBusinessEvent): BusinessEvent;
  all(): readonly BusinessEvent[];
  forRequest(requestId: string): readonly BusinessEvent[];
}
