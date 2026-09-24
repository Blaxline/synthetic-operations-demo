import { DomainError } from "../domain/errors.ts";
import { assertPositiveCents, type Cents } from "../domain/money.ts";
import {
  assertCanApprove,
  outstandingApprovals,
  type PurchaseRequest,
  type Role,
  type SpendCategory,
  transition,
  type Vendor,
} from "../domain/purchase-request.ts";
import type { EventLog } from "../observability/business-events.ts";
import { type ApprovalPolicy, evaluatePolicy, policyInEffect } from "../rules/policy.ts";
import {
  type Clock,
  type Directory,
  ErpError,
  type ErpGateway,
  type PurchaseRequestRepository,
} from "./ports.ts";

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 60_000,
  maxDelayMs: 15 * 60_000,
};

/**
 * Exponential backoff without jitter, so the demo and tests are deterministic.
 * A production deployment with many workers would add full jitter.
 */
export function retryDelayMs(policy: RetryPolicy, failedAttempt: number): number {
  return Math.min(policy.baseDelayMs * 2 ** (failedAttempt - 1), policy.maxDelayMs);
}

export interface Dependencies {
  readonly requests: PurchaseRequestRepository;
  readonly events: EventLog;
  readonly erp: ErpGateway;
  readonly clock: Clock;
  readonly directory: Directory;
  readonly policies: readonly ApprovalPolicy[];
  readonly retry?: RetryPolicy;
}

export interface SubmitCommand {
  readonly requestId: string;
  readonly requesterId: string;
  readonly vendor: Vendor;
  readonly category: SpendCategory;
  readonly amountCents: Cents;
  readonly description: string;
}

export interface PostingRunSummary {
  readonly posted: readonly string[];
  readonly scheduledForRetry: readonly string[];
  readonly needsAttention: readonly string[];
}

const ERP_WORKER = "system:erp-posting";

export class PurchaseRequestService {
  readonly #deps: Dependencies;
  readonly #retry: RetryPolicy;

  constructor(deps: Dependencies) {
    this.#deps = deps;
    this.#retry = deps.retry ?? DEFAULT_RETRY_POLICY;
  }

  submit(command: SubmitCommand): PurchaseRequest {
    assertPositiveCents(command.amountCents, "amountCents");
    if (this.#deps.requests.get(command.requestId)) {
      throw new DomainError("duplicate_request", `Request ${command.requestId} already exists.`);
    }

    const now = this.#now();
    const policy = policyInEffect(this.#deps.policies, new Date(now));
    const decision = evaluatePolicy(policy, command);

    const draft: PurchaseRequest = {
      id: command.requestId,
      requesterId: command.requesterId,
      vendor: command.vendor,
      category: command.category,
      amountCents: command.amountCents,
      description: command.description,
      state: "pending_approval",
      policyVersion: decision.policyVersion,
      requiredApprovals: decision.requiredApprovals,
      approvals: [],
      erp: { attempts: 0, nextAttemptAt: null, documentNumber: null, lastError: null },
      submittedAt: now,
      version: 0,
    };

    const automatic = decision.requiredApprovals.length === 0;
    const saved = this.#deps.requests.save(automatic ? transition(draft, "approved") : draft);

    this.#deps.events.append({
      type: "request.submitted",
      requestId: saved.id,
      actorId: command.requesterId,
      occurredAt: now,
      data: {
        amountCents: saved.amountCents,
        category: saved.category,
        vendorId: saved.vendor.id,
        vendorIsNew: saved.vendor.isNew,
        policyVersion: saved.policyVersion,
        requiredRoles: saved.requiredApprovals.map((approval) => approval.role),
        ruleIds: saved.requiredApprovals.flatMap((approval) => approval.ruleIds),
      },
    });
    if (automatic) {
      this.#deps.events.append({
        type: "request.approved",
        requestId: saved.id,
        actorId: "system:policy",
        occurredAt: now,
        data: { policyVersion: saved.policyVersion, automatic: true },
      });
    }
    return saved;
  }

  approve(requestId: string, approverId: string, role: Role): PurchaseRequest {
    const request = this.#load(requestId);
    assertCanApprove(request, approverId, role, this.#deps.directory.rolesOf(approverId));

    const now = this.#now();
    const withApproval: PurchaseRequest = {
      ...request,
      approvals: [...request.approvals, { role, approverId, at: now }],
    };
    const complete = outstandingApprovals(withApproval).length === 0;
    const saved = this.#deps.requests.save(
      complete ? transition(withApproval, "approved") : withApproval,
    );

    this.#deps.events.append({
      type: "request.approval_recorded",
      requestId,
      actorId: approverId,
      occurredAt: now,
      data: { role },
    });
    if (complete) {
      this.#deps.events.append({
        type: "request.approved",
        requestId,
        actorId: approverId,
        occurredAt: now,
        data: { policyVersion: saved.policyVersion, automatic: false },
      });
    }
    return saved;
  }

  reject(requestId: string, approverId: string, reason: string): PurchaseRequest {
    const request = this.#load(requestId);
    if (approverId === request.requesterId) {
      throw new DomainError(
        "separation_of_duties",
        `${approverId} submitted ${requestId} and cannot decide on it.`,
      );
    }
    const saved = this.#deps.requests.save(transition(request, "rejected"));
    this.#deps.events.append({
      type: "request.rejected",
      requestId,
      actorId: approverId,
      occurredAt: this.#now(),
      data: { reason },
    });
    return saved;
  }

  /**
   * One pass of the background posting job. Every approved request that is due
   * gets one attempt; failures are classified and either scheduled or escalated.
   */
  async postDueRequests(): Promise<PostingRunSummary> {
    const now = this.#deps.clock.now();
    const summary = {
      posted: [] as string[],
      scheduledForRetry: [] as string[],
      needsAttention: [] as string[],
    };

    for (const request of this.#deps.requests.dueForPosting(now)) {
      const outcome = await this.#attemptPosting(request, now);
      summary[outcome].push(request.id);
    }
    return summary;
  }

  resolveException(
    requestId: string,
    operatorId: string,
    resolution: "retry" | "cancel",
    note: string,
  ): PurchaseRequest {
    const request = this.#load(requestId);
    if (request.state !== "needs_attention") {
      throw new DomainError(
        "invalid_transition",
        `Request ${requestId} is "${request.state}"; only requests that need attention can be resolved.`,
      );
    }

    const next =
      resolution === "retry"
        ? {
            ...transition(request, "approved"),
            erp: { ...request.erp, attempts: 0, nextAttemptAt: null },
          }
        : transition(request, "rejected");
    const saved = this.#deps.requests.save(next);

    this.#deps.events.append({
      type: "request.exception_resolved",
      requestId,
      actorId: operatorId,
      occurredAt: this.#now(),
      data: { resolution, note },
    });
    return saved;
  }

  async #attemptPosting(
    request: PurchaseRequest,
    now: Date,
  ): Promise<"posted" | "scheduledForRetry" | "needsAttention"> {
    const attempt = request.erp.attempts + 1;
    const idempotencyKey = `purchase-request:${request.id}`;
    const occurredAt = now.toISOString();

    this.#deps.events.append({
      type: "erp.posting_attempted",
      requestId: request.id,
      actorId: ERP_WORKER,
      occurredAt,
      data: { attempt, idempotencyKey },
    });

    try {
      const result = await this.#deps.erp.postPurchaseOrder({
        idempotencyKey,
        requestId: request.id,
        vendorId: request.vendor.id,
        amountCents: request.amountCents,
      });
      this.#deps.requests.save({
        ...transition(request, "posted"),
        erp: {
          attempts: attempt,
          nextAttemptAt: null,
          documentNumber: result.documentNumber,
          lastError: null,
        },
      });
      this.#deps.events.append({
        type: "erp.posting_succeeded",
        requestId: request.id,
        actorId: ERP_WORKER,
        occurredAt,
        data: { attempt, documentNumber: result.documentNumber, replayed: result.replayed },
      });
      return "posted";
    } catch (error) {
      // Unknown errors are treated as transient: the outcome is ambiguous, and
      // the idempotency key makes a retry safe even if the ERP did commit.
      const failure = error instanceof ErpError ? error.kind : "transient";
      const message = error instanceof Error ? error.message : String(error);
      const exhausted = attempt >= this.#retry.maxAttempts;
      const escalate = failure === "permanent" || exhausted;
      const nextAttemptAt = escalate
        ? null
        : new Date(now.getTime() + retryDelayMs(this.#retry, attempt)).toISOString();

      const erp = { ...request.erp, attempts: attempt, nextAttemptAt, lastError: message };
      this.#deps.requests.save(
        escalate ? { ...transition(request, "needs_attention"), erp } : { ...request, erp },
      );

      this.#deps.events.append({
        type: "erp.posting_failed",
        requestId: request.id,
        actorId: ERP_WORKER,
        occurredAt,
        data: { attempt, failure, message, nextAttemptAt },
      });
      if (!escalate) return "scheduledForRetry";

      this.#deps.events.append({
        type: "request.needs_attention",
        requestId: request.id,
        actorId: ERP_WORKER,
        occurredAt,
        data: {
          reason:
            failure === "permanent"
              ? `ERP rejected the purchase order: ${message}`
              : `ERP still unavailable after ${attempt} attempts: ${message}`,
        },
      });
      return "needsAttention";
    }
  }

  #load(requestId: string): PurchaseRequest {
    const request = this.#deps.requests.get(requestId);
    if (!request) {
      throw new DomainError("not_found", `Request ${requestId} does not exist.`);
    }
    return request;
  }

  #now(): string {
    return this.#deps.clock.now().toISOString();
  }
}
