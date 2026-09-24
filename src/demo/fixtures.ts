/**
 * SYNTHETIC DATA. Every company, person, vendor and amount in this file is
 * invented for demonstration. None of it describes a real customer.
 */
import { PurchaseRequestService } from "../application/purchase-request-service.ts";
import { dollars } from "../domain/money.ts";
import type { Vendor } from "../domain/purchase-request.ts";
import { ControlledClock, StaticDirectory } from "../infrastructure/clock-and-directory.ts";
import {
  InMemoryEventLog,
  InMemoryPurchaseRequestRepository,
} from "../infrastructure/in-memory-store.ts";
import { SyntheticErp } from "../infrastructure/synthetic-erp.ts";
import type { PolicyInput } from "../rules/policy.ts";
import { ALL_POLICIES } from "../rules/versions.ts";

export const PEOPLE = {
  requester: "ana.operations",
  manager: "marco.manager",
  secondManager: "tomas.manager",
  finance: "lucia.finance",
  payablesOperator: "diego.payables",
} as const;

export const VENDORS = {
  officeSupplies: { id: "vendor-northline-office", isNew: false },
  itHardware: { id: "vendor-kestrel-it", isNew: false },
  steel: { id: "vendor-harbor-steel", isNew: false },
  consulting: { id: "vendor-quill-advisory", isNew: false },
  newLogistics: { id: "vendor-orbit-logistics", isNew: true },
  newPackaging: { id: "vendor-lumen-packaging", isNew: true },
} as const satisfies Record<string, Vendor>;

export function createSyntheticOperation(start: string) {
  const clock = new ControlledClock(start);
  const erp = new SyntheticErp([
    VENDORS.officeSupplies.id,
    VENDORS.itHardware.id,
    VENDORS.steel.id,
    VENDORS.consulting.id,
  ]);
  const events = new InMemoryEventLog();
  const service = new PurchaseRequestService({
    requests: new InMemoryPurchaseRequestRepository(),
    events,
    erp,
    clock,
    policies: ALL_POLICIES,
    directory: new StaticDirectory({
      [PEOPLE.manager]: ["manager"],
      [PEOPLE.secondManager]: ["manager"],
      [PEOPLE.finance]: ["finance"],
    }),
  });
  return { clock, erp, events, service };
}

/** A synthetic month of historical requests, used to replay a policy change. */
export const HISTORICAL_CASES: readonly { caseId: string; input: PolicyInput }[] = [
  {
    caseId: "H-01",
    input: {
      amountCents: dollars(850),
      category: "office_supplies",
      vendor: VENDORS.officeSupplies,
    },
  },
  {
    caseId: "H-02",
    input: { amountCents: dollars(4_900), category: "it_equipment", vendor: VENDORS.itHardware },
  },
  {
    caseId: "H-03",
    input: { amountCents: dollars(6_200), category: "it_equipment", vendor: VENDORS.itHardware },
  },
  {
    caseId: "H-04",
    input: { amountCents: dollars(12_000), category: "services", vendor: VENDORS.consulting },
  },
  {
    caseId: "H-05",
    input: { amountCents: dollars(9_800), category: "services", vendor: VENDORS.consulting },
  },
  {
    caseId: "H-06",
    input: { amountCents: dollars(31_000), category: "raw_materials", vendor: VENDORS.steel },
  },
  {
    caseId: "H-07",
    input: { amountCents: dollars(2_400), category: "raw_materials", vendor: VENDORS.newLogistics },
  },
  {
    caseId: "H-08",
    input: { amountCents: dollars(7_300), category: "raw_materials", vendor: VENDORS.newPackaging },
  },
  {
    caseId: "H-09",
    input: { amountCents: dollars(18_500), category: "services", vendor: VENDORS.consulting },
  },
  {
    caseId: "H-10",
    input: {
      amountCents: dollars(1_150),
      category: "office_supplies",
      vendor: VENDORS.officeSupplies,
    },
  },
];
