import { dollars } from "../domain/money.ts";
import type { ApprovalPolicy, PolicyRule } from "./policy.ts";

const managerThreshold: PolicyRule = {
  id: "manager-threshold",
  description: "Spend of $5,000 or more requires a manager.",
  requires: "manager",
  applies: ({ amountCents }) => amountCents >= dollars(5_000),
};

const financeThreshold: PolicyRule = {
  id: "finance-threshold",
  description: "Spend of $25,000 or more requires finance.",
  requires: "finance",
  applies: ({ amountCents }) => amountCents >= dollars(25_000),
};

/**
 * v1.1 addition. Observed in operation: purchases from vendors with no history
 * reached the ERP before the vendor was registered there, and failed at posting.
 */
const financeNewVendor: PolicyRule = {
  id: "finance-new-vendor",
  description: "Any spend with a new vendor requires finance, regardless of amount.",
  requires: "finance",
  applies: ({ vendor }) => vendor.isNew,
};

/** v1.1 addition. Services spend is reviewed by finance at a lower threshold. */
const financeServices: PolicyRule = {
  id: "finance-services",
  description: "Services spend of $10,000 or more requires finance.",
  requires: "finance",
  applies: ({ category, amountCents }) => category === "services" && amountCents >= dollars(10_000),
};

export const POLICY_V1: ApprovalPolicy = {
  version: "1.0",
  effectiveFrom: "2026-01-01T00:00:00Z",
  rules: [managerThreshold, financeThreshold],
};

export const POLICY_V1_1: ApprovalPolicy = {
  version: "1.1",
  effectiveFrom: "2026-09-15T00:00:00Z",
  rules: [managerThreshold, financeThreshold, financeNewVendor, financeServices],
};

export const ALL_POLICIES: readonly ApprovalPolicy[] = [POLICY_V1, POLICY_V1_1];
