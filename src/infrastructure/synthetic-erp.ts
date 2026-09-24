import {
  ErpError,
  type ErpGateway,
  type ErpPostingResult,
  type ErpPurchaseOrder,
} from "../application/ports.ts";

/**
 * Failure modes seen in real ERP integrations:
 * - unavailable: rejected before anything was written.
 * - timeout_after_commit: the order was written, but the response never
 *   arrived. The caller cannot tell this apart from "unavailable".
 */
export type ScriptedFault = "unavailable" | "timeout_after_commit";

/**
 * A deterministic stand-in for an ERP purchase-order API. It deduplicates on
 * the idempotency key and rejects orders for vendors it does not know.
 */
export class SyntheticErp implements ErpGateway {
  readonly #registeredVendors: Set<string>;
  readonly #ordersByKey = new Map<string, ErpPurchaseOrder & { documentNumber: string }>();
  readonly #faultsByRequest = new Map<string, ScriptedFault[]>();
  #nextDocumentNumber = 4500001;

  constructor(registeredVendors: readonly string[]) {
    this.#registeredVendors = new Set(registeredVendors);
  }

  /** Queue faults for the next attempts of one request, consumed in order. */
  scriptFaults(requestId: string, faults: readonly ScriptedFault[]): void {
    this.#faultsByRequest.set(requestId, [...faults]);
  }

  registerVendor(vendorId: string): void {
    this.#registeredVendors.add(vendorId);
  }

  /** Number of distinct purchase orders actually stored in the ERP. */
  get storedOrderCount(): number {
    return this.#ordersByKey.size;
  }

  async postPurchaseOrder(order: ErpPurchaseOrder): Promise<ErpPostingResult> {
    const fault = this.#faultsByRequest.get(order.requestId)?.shift();

    if (fault === "unavailable") {
      throw new ErpError("transient", "ERP returned 503 Service Unavailable.");
    }

    const existing = this.#ordersByKey.get(order.idempotencyKey);
    if (existing) {
      return { documentNumber: existing.documentNumber, replayed: true };
    }

    if (!this.#registeredVendors.has(order.vendorId)) {
      throw new ErpError(
        "permanent",
        `Vendor ${order.vendorId} is not registered in the ERP vendor master.`,
      );
    }

    const documentNumber = `PO-${this.#nextDocumentNumber++}`;
    this.#ordersByKey.set(order.idempotencyKey, { ...order, documentNumber });

    if (fault === "timeout_after_commit") {
      throw new ErpError("transient", "ERP response timed out after 30s.");
    }
    return { documentNumber, replayed: false };
  }
}
