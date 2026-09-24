import { describe, expect, it } from "vitest";
import { DomainError } from "../src/domain/errors.ts";
import { dollars } from "../src/domain/money.ts";
import { canTransition } from "../src/domain/purchase-request.ts";
import { AFTER_V1_1, PEOPLE, request, setup, VENDORS } from "./support.ts";

function expectDomainError(action: () => unknown, code: DomainError["code"]): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    return;
  }
  throw new Error(`Expected a DomainError with code "${code}", but nothing was thrown.`);
}

describe("submission", () => {
  it("approves automatically when the policy requires no review", () => {
    const { service, events } = setup();
    const saved = service.submit(request({ amountCents: dollars(900) }));

    expect(saved.state).toBe("approved");
    expect(events.forRequest(saved.id).map((event) => event.type)).toEqual([
      "request.submitted",
      "request.approved",
    ]);
  });

  it("waits for review and stamps the policy version that decided it", () => {
    const { service } = setup();
    const saved = service.submit(request({ amountCents: dollars(8_000) }));

    expect(saved.state).toBe("pending_approval");
    expect(saved.policyVersion).toBe("1.0");
    expect(saved.requiredApprovals.map((approval) => approval.role)).toEqual(["manager"]);
  });

  it.each([0, -100, 10.5, Number.NaN])("rejects an invalid amount (%s cents)", (amountCents) => {
    const { service } = setup();
    expectDomainError(() => service.submit(request({ amountCents })), "invalid_amount");
  });

  it("refuses to submit the same request id twice", () => {
    const { service } = setup();
    service.submit(request());
    expectDomainError(() => service.submit(request()), "duplicate_request");
  });
});

describe("approval", () => {
  it("completes only when every required role has approved", () => {
    const { service } = setup();
    service.submit(request({ amountCents: dollars(30_000) }));

    expect(service.approve("PR-TEST", PEOPLE.manager, "manager").state).toBe("pending_approval");
    expect(service.approve("PR-TEST", PEOPLE.finance, "finance").state).toBe("approved");
  });

  it("does not let the requester approve their own request", () => {
    const { service } = setup();
    service.submit(request({ amountCents: dollars(8_000) }));
    expectDomainError(
      () => service.approve("PR-TEST", PEOPLE.requester, "manager"),
      "separation_of_duties",
    );
  });

  it("does not let one person satisfy two required approvals", () => {
    const { service } = setup();
    service.submit(request({ amountCents: dollars(30_000) }));
    service.approve("PR-TEST", PEOPLE.manager, "manager");
    expectDomainError(
      () => service.approve("PR-TEST", PEOPLE.manager, "finance"),
      "separation_of_duties",
    );
  });

  it("requires the approver to hold the role they approve as", () => {
    const { service } = setup();
    service.submit(request({ amountCents: dollars(30_000) }));
    expectDomainError(() => service.approve("PR-TEST", PEOPLE.manager, "finance"), "missing_role");
  });

  it("rejects approvals the policy did not ask for", () => {
    const { service } = setup();
    service.submit(request({ amountCents: dollars(8_000) }));
    expectDomainError(
      () => service.approve("PR-TEST", PEOPLE.finance, "finance"),
      "approval_not_required",
    );
  });

  it("does not accept approvals after a decision", () => {
    const { service } = setup();
    service.submit(request({ amountCents: dollars(8_000) }));
    service.reject("PR-TEST", PEOPLE.manager, "Budget moved to Q4");
    expectDomainError(
      () => service.approve("PR-TEST", PEOPLE.secondManager, "manager"),
      "invalid_transition",
    );
  });
});

describe("policy evolution", () => {
  it("keeps in-flight requests on the policy they were submitted under", () => {
    const { service, clock } = setup("2026-09-14T16:00:00Z");
    // Under 1.1 this would also need finance (services >= $10,000).
    service.submit(
      request({ category: "services", vendor: VENDORS.consulting, amountCents: dollars(12_000) }),
    );

    clock.set(AFTER_V1_1);
    const approved = service.approve("PR-TEST", PEOPLE.manager, "manager");

    expect(approved.policyVersion).toBe("1.0");
    expect(approved.state).toBe("approved");
  });

  it("applies the new policy to requests submitted after it takes effect", () => {
    const { service } = setup(AFTER_V1_1);
    const saved = service.submit(
      request({ vendor: VENDORS.newLogistics, amountCents: dollars(500) }),
    );

    expect(saved.policyVersion).toBe("1.1");
    expect(saved.requiredApprovals).toEqual([{ role: "finance", ruleIds: ["finance-new-vendor"] }]);
  });
});

describe("state machine", () => {
  it("has no way out of terminal states", () => {
    for (const to of ["pending_approval", "approved", "needs_attention"] as const) {
      expect(canTransition("posted", to)).toBe(false);
      expect(canTransition("rejected", to)).toBe(false);
    }
  });

  it("cannot skip approval and post directly", () => {
    expect(canTransition("pending_approval", "posted")).toBe(false);
  });
});
