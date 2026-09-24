import { DomainError } from "./errors.ts";
import type { Cents } from "./money.ts";

export type Role = "manager" | "finance";

export type SpendCategory = "office_supplies" | "it_equipment" | "services" | "raw_materials";

export type RequestState =
  | "pending_approval"
  | "approved"
  | "rejected"
  | "posted"
  | "needs_attention";

export interface Vendor {
  readonly id: string;
  /** A vendor with no purchasing history at the time of the request. */
  readonly isNew: boolean;
}

/** Why a role must approve: the rules that required it, kept for the audit trail. */
export interface RequiredApproval {
  readonly role: Role;
  readonly ruleIds: readonly string[];
}

export interface RecordedApproval {
  readonly role: Role;
  readonly approverId: string;
  readonly at: string;
}

export interface ErpPosting {
  readonly attempts: number;
  readonly nextAttemptAt: string | null;
  readonly documentNumber: string | null;
  readonly lastError: string | null;
}

export interface PurchaseRequest {
  readonly id: string;
  readonly requesterId: string;
  readonly vendor: Vendor;
  readonly category: SpendCategory;
  readonly amountCents: Cents;
  readonly description: string;
  readonly state: RequestState;
  /** Policy in effect at submission. In-flight requests are never re-evaluated. */
  readonly policyVersion: string;
  readonly requiredApprovals: readonly RequiredApproval[];
  readonly approvals: readonly RecordedApproval[];
  readonly erp: ErpPosting;
  readonly submittedAt: string;
  /** Optimistic concurrency token, incremented by the repository on every save. */
  readonly version: number;
}

const ALLOWED_TRANSITIONS: Readonly<Record<RequestState, readonly RequestState[]>> = {
  pending_approval: ["approved", "rejected"],
  approved: ["posted", "needs_attention"],
  needs_attention: ["approved", "rejected"],
  posted: [],
  rejected: [],
};

export function canTransition(from: RequestState, to: RequestState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function transition(request: PurchaseRequest, to: RequestState): PurchaseRequest {
  if (!canTransition(request.state, to)) {
    throw new DomainError(
      "invalid_transition",
      `Request ${request.id} cannot move from "${request.state}" to "${to}".`,
    );
  }
  return { ...request, state: to };
}

export function outstandingApprovals(request: PurchaseRequest): readonly RequiredApproval[] {
  return request.requiredApprovals.filter(
    (required) => !request.approvals.some((given) => given.role === required.role),
  );
}

/**
 * Separation of duties is an invariant of the operation, not a versioned
 * business rule: no policy version is allowed to relax it.
 */
export function assertCanApprove(
  request: PurchaseRequest,
  approverId: string,
  role: Role,
  approverRoles: readonly Role[],
): void {
  if (request.state !== "pending_approval") {
    throw new DomainError(
      "invalid_transition",
      `Request ${request.id} is "${request.state}" and no longer accepts approvals.`,
    );
  }
  if (approverId === request.requesterId) {
    throw new DomainError(
      "separation_of_duties",
      `${approverId} submitted ${request.id} and cannot approve it. Route it to another ${role}.`,
    );
  }
  if (request.approvals.some((given) => given.approverId === approverId)) {
    throw new DomainError(
      "separation_of_duties",
      `${approverId} already approved ${request.id}. Each required approval needs a different person.`,
    );
  }
  if (!approverRoles.includes(role)) {
    throw new DomainError("missing_role", `${approverId} does not hold the "${role}" role.`);
  }
  if (!outstandingApprovals(request).some((required) => required.role === role)) {
    throw new DomainError(
      "approval_not_required",
      `${request.id} does not need a "${role}" approval under policy ${request.policyVersion}.`,
    );
  }
}
