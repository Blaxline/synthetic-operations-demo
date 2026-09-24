import type { Cents } from "../domain/money.ts";
import type { PurchaseRequest, Role } from "../domain/purchase-request.ts";

export interface PurchaseRequestRepository {
  get(id: string): PurchaseRequest | undefined;
  /**
   * Inserts a new request (version 0) or replaces an existing one. Rejects the
   * write if the stored version no longer matches the version the caller read.
   */
  save(request: PurchaseRequest): PurchaseRequest;
  /** Approved requests whose next ERP attempt is due. */
  dueForPosting(now: Date): readonly PurchaseRequest[];
}

export interface ErpPurchaseOrder {
  /** Same key on every attempt for the same request: the ERP deduplicates on it. */
  readonly idempotencyKey: string;
  readonly requestId: string;
  readonly vendorId: string;
  readonly amountCents: Cents;
}

export interface ErpPostingResult {
  readonly documentNumber: string;
  readonly replayed: boolean;
}

export interface ErpGateway {
  postPurchaseOrder(order: ErpPurchaseOrder): Promise<ErpPostingResult>;
}

/**
 * Transient: safe to retry later. Permanent: retrying cannot succeed until a
 * person changes something, so the request goes to exception handling.
 */
export class ErpError extends Error {
  readonly kind: "transient" | "permanent";

  constructor(kind: "transient" | "permanent", message: string) {
    super(message);
    this.name = "ErpError";
    this.kind = kind;
  }
}

export interface Clock {
  now(): Date;
}

export interface Directory {
  rolesOf(userId: string): readonly Role[];
}
