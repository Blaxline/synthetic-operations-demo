/**
 * Walks one synthetic purchasing operation through the full cycle:
 * approvals and separation of duties, ERP failures and recovery, an exception
 * that needs a person, and the business-rule change that the exception motivates.
 */
import { DomainError } from "../domain/errors.ts";
import { dollars } from "../domain/money.ts";
import { deriveValueSignals } from "../observability/value-signals.ts";
import { createSyntheticOperation, PEOPLE, VENDORS } from "./fixtures.ts";
import { auditTrail, banner, line, section, table } from "./render.ts";

const { clock, erp, events, service } = createSyntheticOperation("2026-09-08T09:00:00Z");

async function runPostingJob(label: string): Promise<void> {
  const result = await service.postDueRequests();
  line(
    `${label} at ${clock.now().toISOString().slice(11, 16)} UTC: posted [${result.posted.join(", ")}], retry scheduled [${result.scheduledForRetry.join(", ")}], needs attention [${result.needsAttention.join(", ")}]`,
  );
}

function erpErrorOf(requestId: string): string {
  const failure = events
    .forRequest(requestId)
    .findLast((event) => event.type === "erp.posting_failed");
  return failure?.type === "erp.posting_failed" ? failure.data.message : "no ERP failure recorded";
}

banner("Purchase approvals around an ERP: from v1 to v1.1");

section("1. Requests arrive under policy 1.0");
service.submit({
  requestId: "PR-1001",
  requesterId: PEOPLE.requester,
  vendor: VENDORS.officeSupplies,
  category: "office_supplies",
  amountCents: dollars(1_200),
  description: "Quarterly office consumables",
});
service.submit({
  requestId: "PR-1002",
  requesterId: PEOPLE.requester,
  vendor: VENDORS.itHardware,
  category: "it_equipment",
  amountCents: dollars(18_000),
  description: "Laptops for the new warehouse shift",
});
service.submit({
  requestId: "PR-1003",
  requesterId: PEOPLE.requester,
  vendor: VENDORS.steel,
  category: "raw_materials",
  amountCents: dollars(40_000),
  description: "Steel coil, October production run",
});
service.submit({
  requestId: "PR-1004",
  requesterId: PEOPLE.requester,
  vendor: VENDORS.consulting,
  category: "services",
  amountCents: dollars(7_500),
  description: "Inventory process review",
});
service.submit({
  requestId: "PR-1005",
  requesterId: PEOPLE.requester,
  vendor: VENDORS.newLogistics,
  category: "services",
  amountCents: dollars(3_000),
  description: "Pilot freight lane with a new carrier",
});
line(
  "Five requests submitted. PR-1001 and PR-1005 fall below every threshold and are approved automatically.",
);

section("2. Approvals, with separation of duties enforced");
try {
  service.approve("PR-1002", PEOPLE.requester, "manager");
} catch (error) {
  if (!(error instanceof DomainError)) throw error;
  line(`Blocked: ${error.message}`);
}
service.approve("PR-1002", PEOPLE.manager, "manager");
service.approve("PR-1003", PEOPLE.manager, "manager");
service.approve("PR-1003", PEOPLE.finance, "finance");
service.approve("PR-1004", PEOPLE.secondManager, "manager");
line("PR-1002, PR-1003 and PR-1004 approved by the roles their policy required.");

section("3. Operate: posting to the ERP when the ERP misbehaves");
erp.scriptFaults("PR-1003", ["unavailable", "unavailable"]);
erp.scriptFaults("PR-1004", ["timeout_after_commit"]);
await runPostingJob("Run 1");
clock.advanceMinutes(1);
await runPostingJob("Run 2");
clock.advanceMinutes(2);
await runPostingJob("Run 3");

section("4. Observe: the exception that needs a person");
line(`PR-1005 is waiting for a person: ${erpErrorOf("PR-1005")}`);
line(
  "Retrying cannot fix this. Payables registers the carrier in the ERP vendor master, then releases it.",
);
erp.registerVendor(VENDORS.newLogistics.id);
clock.advanceMinutes(40);
service.resolveException(
  "PR-1005",
  PEOPLE.payablesOperator,
  "retry",
  "Carrier registered in vendor master after tax ID verification.",
);
await runPostingJob("Run 4");
line("");
line("Full audit trail for PR-1005:");
auditTrail(events.forRequest("PR-1005"));

section("5. Evolve: policy 1.1 takes effect on 2026-09-15");
clock.set("2026-09-14T16:00:00Z");
service.submit({
  requestId: "PR-1006",
  requesterId: PEOPLE.requester,
  vendor: VENDORS.consulting,
  category: "services",
  amountCents: dollars(12_000),
  description: "Warehouse layout study",
});
line("PR-1006 is submitted on 2026-09-14 under 1.0: manager review only.");

clock.set("2026-09-15T09:00:00Z");
service.submit({
  requestId: "PR-1007",
  requesterId: PEOPLE.requester,
  vendor: VENDORS.newPackaging,
  category: "raw_materials",
  amountCents: dollars(2_000),
  description: "Trial order of recycled packaging",
});
line("PR-1007 is submitted under 1.1: a new vendor now requires finance, even at $2,000.");

service.approve("PR-1006", PEOPLE.manager, "manager");
line(
  "PR-1006 completes with the manager approval alone. In-flight requests keep the policy they started under.",
);
erp.registerVendor(VENDORS.newPackaging.id);
service.approve("PR-1007", PEOPLE.finance, "finance");
await runPostingJob("Run 5");

section("6. Value signals, derived only from business events");
const signals = deriveValueSignals(events.all());
table(
  ["signal", "value"],
  [
    ["requests submitted", String(signals.submitted)],
    ["approved automatically", String(signals.approvedAutomatically)],
    ["approved after review", String(signals.approvedAfterReview)],
    ["posted to ERP", String(signals.posted)],
    ["ERP failures absorbed by retry", String(signals.failuresAbsorbedByRetry)],
    ["duplicate orders prevented", String(signals.duplicatesPrevented)],
    ["exceptions raised / resolved", `${signals.exceptionsRaised} / ${signals.exceptionsResolved}`],
    ["purchase orders stored in ERP", String(erp.storedOrderCount)],
  ],
);
line("");
line("Run `pnpm demo:impact` to see how 1.1 would have treated last month's requests.");
