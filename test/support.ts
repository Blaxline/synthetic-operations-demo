import type { SubmitCommand } from "../src/application/purchase-request-service.ts";
import { createSyntheticOperation, PEOPLE, VENDORS } from "../src/demo/fixtures.ts";
import { dollars } from "../src/domain/money.ts";

/** A date when policy 1.0 is in effect. Policy 1.1 starts 2026-09-15. */
export const BEFORE_V1_1 = "2026-09-08T09:00:00Z";
export const AFTER_V1_1 = "2026-09-16T09:00:00Z";

export function setup(start = BEFORE_V1_1) {
  return createSyntheticOperation(start);
}

export function request(overrides: Partial<SubmitCommand> = {}): SubmitCommand {
  return {
    requestId: "PR-TEST",
    requesterId: PEOPLE.requester,
    vendor: VENDORS.itHardware,
    category: "it_equipment",
    amountCents: dollars(1_000),
    description: "Test request",
    ...overrides,
  };
}

export { PEOPLE, VENDORS };
