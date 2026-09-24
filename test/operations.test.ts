import { describe, expect, it } from "vitest";
import type { ErpGateway } from "../src/application/ports.ts";
import {
  DEFAULT_RETRY_POLICY,
  PurchaseRequestService,
  retryDelayMs,
} from "../src/application/purchase-request-service.ts";
import { DomainError } from "../src/domain/errors.ts";
import { dollars } from "../src/domain/money.ts";
import type { PurchaseRequest } from "../src/domain/purchase-request.ts";
import { ControlledClock, StaticDirectory } from "../src/infrastructure/clock-and-directory.ts";
import {
  InMemoryEventLog,
  InMemoryPurchaseRequestRepository,
} from "../src/infrastructure/in-memory-store.ts";
import { deriveValueSignals } from "../src/observability/value-signals.ts";
import { ALL_POLICIES } from "../src/rules/versions.ts";
import { BEFORE_V1_1, PEOPLE, request, setup, VENDORS } from "./support.ts";

describe("ERP posting", () => {
  it("posts approved requests and records the ERP document number", async () => {
    const { service, erp } = setup();
    service.submit(request());

    const run = await service.postDueRequests();

    expect(run.posted).toEqual(["PR-TEST"]);
    expect(erp.storedOrderCount).toBe(1);
  });

  it("never posts a request that is still waiting for approval", async () => {
    const { service, erp } = setup();
    service.submit(request({ amountCents: dollars(8_000) }));

    await service.postDueRequests();

    expect(erp.storedOrderCount).toBe(0);
  });

  it("schedules transient failures with backoff and does not retry early", async () => {
    const { service, erp, clock } = setup();
    service.submit(request());
    erp.scriptFaults("PR-TEST", ["unavailable"]);

    expect((await service.postDueRequests()).scheduledForRetry).toEqual(["PR-TEST"]);

    clock.advanceMinutes(0.5);
    expect((await service.postDueRequests()).posted).toEqual([]);

    clock.advanceMinutes(0.5);
    expect((await service.postDueRequests()).posted).toEqual(["PR-TEST"]);
  });

  it("does not create a duplicate when the ERP committed but the response was lost", async () => {
    const { service, erp, clock, events } = setup();
    service.submit(request());
    erp.scriptFaults("PR-TEST", ["timeout_after_commit"]);

    await service.postDueRequests();
    clock.advanceMinutes(1);
    await service.postDueRequests();

    expect(erp.storedOrderCount).toBe(1);
    const success = events.forRequest("PR-TEST").find((e) => e.type === "erp.posting_succeeded");
    expect(success?.type === "erp.posting_succeeded" && success.data.replayed).toBe(true);
  });

  it("escalates to a person once the retry budget is spent", async () => {
    const { service, erp, clock } = setup();
    service.submit(request());
    erp.scriptFaults("PR-TEST", ["unavailable", "unavailable", "unavailable"]);

    await service.postDueRequests();
    clock.advanceMinutes(1);
    await service.postDueRequests();
    clock.advanceMinutes(2);
    const last = await service.postDueRequests();

    expect(last.needsAttention).toEqual(["PR-TEST"]);
  });

  it("escalates permanent failures immediately instead of retrying", async () => {
    const { service, events } = setup();
    service.submit(request({ vendor: VENDORS.newLogistics }));

    const run = await service.postDueRequests();

    expect(run.needsAttention).toEqual(["PR-TEST"]);
    expect(
      events.forRequest("PR-TEST").filter((e) => e.type === "erp.posting_attempted"),
    ).toHaveLength(1);
  });

  it("treats unexpected errors as transient, because the outcome is ambiguous", async () => {
    const failingErp: ErpGateway = {
      postPurchaseOrder: () => Promise.reject(new Error("socket hang up")),
    };
    const service = new PurchaseRequestService({
      requests: new InMemoryPurchaseRequestRepository(),
      events: new InMemoryEventLog(),
      erp: failingErp,
      clock: new ControlledClock(BEFORE_V1_1),
      directory: new StaticDirectory({}),
      policies: ALL_POLICIES,
    });
    service.submit(request());

    expect((await service.postDueRequests()).scheduledForRetry).toEqual(["PR-TEST"]);
  });

  it("uses capped exponential backoff", () => {
    expect([1, 2, 3, 4, 5, 10].map((n) => retryDelayMs(DEFAULT_RETRY_POLICY, n) / 60_000)).toEqual([
      1, 2, 4, 8, 15, 15,
    ]);
  });
});

describe("exception handling", () => {
  it("releases a request for retry after a person fixes the cause", async () => {
    const { service, erp } = setup();
    service.submit(request({ vendor: VENDORS.newLogistics }));
    await service.postDueRequests();

    erp.registerVendor(VENDORS.newLogistics.id);
    service.resolveException("PR-TEST", PEOPLE.payablesOperator, "retry", "Vendor registered");

    expect((await service.postDueRequests()).posted).toEqual(["PR-TEST"]);
  });

  it("can cancel a request instead of retrying it", async () => {
    const { service } = setup();
    service.submit(request({ vendor: VENDORS.newLogistics }));
    await service.postDueRequests();

    const cancelled = service.resolveException(
      "PR-TEST",
      PEOPLE.payablesOperator,
      "cancel",
      "Vendor failed compliance check",
    );

    expect(cancelled.state).toBe("rejected");
  });

  it("only resolves requests that actually need attention", () => {
    const { service } = setup();
    service.submit(request());
    expect(() =>
      service.resolveException("PR-TEST", PEOPLE.payablesOperator, "retry", "n/a"),
    ).toThrow(DomainError);
  });
});

describe("repository", () => {
  const stored = (): PurchaseRequest => ({
    id: "PR-TEST",
    requesterId: PEOPLE.requester,
    vendor: VENDORS.itHardware,
    category: "it_equipment",
    amountCents: dollars(8_000),
    description: "Test request",
    state: "pending_approval",
    policyVersion: "1.0",
    requiredApprovals: [{ role: "manager", ruleIds: ["manager-threshold"] }],
    approvals: [],
    erp: { attempts: 0, nextAttemptAt: null, documentNumber: null, lastError: null },
    submittedAt: BEFORE_V1_1,
    version: 0,
  });

  it("rejects a write based on a stale read", () => {
    const repository = new InMemoryPurchaseRequestRepository();
    repository.save(stored());
    const firstReader = repository.get("PR-TEST");
    const secondReader = repository.get("PR-TEST");
    if (!firstReader || !secondReader) throw new Error("Fixture was not stored.");

    repository.save({ ...firstReader, description: "first edit" });

    expect(() => repository.save({ ...secondReader, description: "second edit" })).toThrow(
      /changed since it was read/,
    );
  });

  it("does not let callers mutate stored state through returned objects", () => {
    const repository = new InMemoryPurchaseRequestRepository();
    repository.save(stored());

    const copy = repository.get("PR-TEST") as { description: string } | undefined;
    if (copy) copy.description = "tampered";

    expect(repository.get("PR-TEST")?.description).toBe("Test request");
  });
});

describe("value signals", () => {
  it("are derived from the event log and add up", async () => {
    const { service, erp, clock, events } = setup();
    service.submit(request({ requestId: "A" }));
    service.submit(request({ requestId: "B", amountCents: dollars(8_000) }));
    service.approve("B", PEOPLE.manager, "manager");
    erp.scriptFaults("A", ["timeout_after_commit"]);

    await service.postDueRequests();
    clock.advanceMinutes(1);
    await service.postDueRequests();

    expect(deriveValueSignals(events.all())).toMatchObject({
      submitted: 2,
      approvedAutomatically: 1,
      approvedAfterReview: 1,
      posted: 2,
      failuresAbsorbedByRetry: 1,
      duplicatesPrevented: 1,
      exceptionsRaised: 0,
    });
  });

  it("assigns every event a gap-free, increasing sequence", () => {
    const { service, events } = setup();
    service.submit(request({ requestId: "A" }));
    service.submit(request({ requestId: "B" }));

    expect(events.all().map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
  });
});
