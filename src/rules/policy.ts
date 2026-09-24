import type { Cents } from "../domain/money.ts";
import type { RequiredApproval, Role, SpendCategory, Vendor } from "../domain/purchase-request.ts";

export interface PolicyInput {
  readonly amountCents: Cents;
  readonly category: SpendCategory;
  readonly vendor: Vendor;
}

/**
 * One business rule. Rule ids are stable across policy versions so that an
 * evolution can be compared rule by rule and explained in the audit trail.
 */
export interface PolicyRule {
  readonly id: string;
  readonly description: string;
  readonly requires: Role;
  readonly applies: (input: PolicyInput) => boolean;
}

export interface ApprovalPolicy {
  readonly version: string;
  /** ISO date (UTC). The policy governs requests submitted on or after it. */
  readonly effectiveFrom: string;
  readonly rules: readonly PolicyRule[];
}

export interface PolicyDecision {
  readonly policyVersion: string;
  /** Empty means the request is approved without human review. */
  readonly requiredApprovals: readonly RequiredApproval[];
}

const ROLE_ORDER: readonly Role[] = ["manager", "finance"];

export function evaluatePolicy(policy: ApprovalPolicy, input: PolicyInput): PolicyDecision {
  const ruleIdsByRole = new Map<Role, string[]>();

  for (const rule of policy.rules) {
    if (!rule.applies(input)) continue;
    const ruleIds = ruleIdsByRole.get(rule.requires) ?? [];
    ruleIds.push(rule.id);
    ruleIdsByRole.set(rule.requires, ruleIds);
  }

  // Deterministic order keeps decisions comparable and the audit trail stable.
  const requiredApprovals = ROLE_ORDER.flatMap((role) => {
    const ruleIds = ruleIdsByRole.get(role);
    return ruleIds ? [{ role, ruleIds }] : [];
  });

  return { policyVersion: policy.version, requiredApprovals };
}

export function policyInEffect(policies: readonly ApprovalPolicy[], at: Date): ApprovalPolicy {
  const candidates = policies
    .filter((policy) => Date.parse(policy.effectiveFrom) <= at.getTime())
    .sort((a, b) => Date.parse(b.effectiveFrom) - Date.parse(a.effectiveFrom));

  const current = candidates[0];
  if (!current) {
    throw new Error(`No approval policy is in effect at ${at.toISOString()}.`);
  }
  return current;
}
