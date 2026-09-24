import { describe, expect, it } from "vitest";
import { dollars } from "../src/domain/money.ts";
import type { Role, SpendCategory, Vendor } from "../src/domain/purchase-request.ts";
import { compareUnderPolicies } from "../src/rules/impact.ts";
import { evaluatePolicy, policyInEffect } from "../src/rules/policy.ts";
import { ALL_POLICIES, POLICY_V1, POLICY_V1_1 } from "../src/rules/versions.ts";

const known: Vendor = { id: "vendor-known", isNew: false };
const fresh: Vendor = { id: "vendor-new", isNew: true };

const roles = (policy: typeof POLICY_V1, amount: number, category: SpendCategory, vendor: Vendor) =>
  evaluatePolicy(policy, { amountCents: dollars(amount), category, vendor }).requiredApprovals.map(
    (approval) => approval.role,
  );

describe("policy 1.0", () => {
  it.each<[number, Role[]]>([
    [4_999.99, []],
    [5_000, ["manager"]],
    [24_999.99, ["manager"]],
    [25_000, ["manager", "finance"]],
  ])("routes %s dollars of known-vendor spend to %j", (amount, expected) => {
    expect(roles(POLICY_V1, amount, "it_equipment", known)).toEqual(expected);
  });

  it("ignores vendor novelty", () => {
    expect(roles(POLICY_V1, 3_000, "services", fresh)).toEqual([]);
  });
});

describe("policy 1.1", () => {
  it("requires finance for any new vendor, regardless of amount", () => {
    expect(roles(POLICY_V1_1, 50, "office_supplies", fresh)).toEqual(["finance"]);
  });

  it("requires finance for services at $10,000 but not below", () => {
    expect(roles(POLICY_V1_1, 9_999.99, "services", known)).toEqual(["manager"]);
    expect(roles(POLICY_V1_1, 10_000, "services", known)).toEqual(["manager", "finance"]);
  });

  it("records every rule that required a role, so the decision can be explained", () => {
    const decision = evaluatePolicy(POLICY_V1_1, {
      amountCents: dollars(30_000),
      category: "services",
      vendor: fresh,
    });
    expect(decision.requiredApprovals).toEqual([
      { role: "manager", ruleIds: ["manager-threshold"] },
      { role: "finance", ruleIds: ["finance-threshold", "finance-new-vendor", "finance-services"] },
    ]);
  });
});

describe("policyInEffect", () => {
  it("switches exactly at the effective instant", () => {
    expect(policyInEffect(ALL_POLICIES, new Date("2026-09-14T23:59:59.999Z")).version).toBe("1.0");
    expect(policyInEffect(ALL_POLICIES, new Date("2026-09-15T00:00:00Z")).version).toBe("1.1");
  });

  it("fails loudly when no policy covers the date", () => {
    expect(() => policyInEffect(ALL_POLICIES, new Date("2025-12-31T00:00:00Z"))).toThrow(
      /No approval policy is in effect/,
    );
  });
});

describe("compareUnderPolicies", () => {
  it("reports which cases change, which rules caused it, and none that lose control", () => {
    const report = compareUnderPolicies(POLICY_V1, POLICY_V1_1, [
      {
        caseId: "unchanged",
        input: { amountCents: dollars(100), category: "office_supplies", vendor: known },
      },
      {
        caseId: "new-vendor",
        input: { amountCents: dollars(100), category: "office_supplies", vendor: fresh },
      },
      {
        caseId: "services",
        input: { amountCents: dollars(12_000), category: "services", vendor: known },
      },
    ]);

    expect(report.changedCount).toBe(2);
    expect(report.newlyReviewedCount).toBe(1);
    expect(report.rows.find((row) => row.caseId === "services")?.rulesAdded).toEqual([
      "finance-services",
    ]);
    expect(report.rows.every((row) => row.rulesRemoved.length === 0)).toBe(true);
  });
});
