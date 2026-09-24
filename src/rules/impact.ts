import type { Role } from "../domain/purchase-request.ts";
import { type ApprovalPolicy, evaluatePolicy, type PolicyInput } from "./policy.ts";

export interface ImpactRow {
  readonly caseId: string;
  readonly rolesBefore: readonly Role[];
  readonly rolesAfter: readonly Role[];
  readonly rulesAdded: readonly string[];
  readonly rulesRemoved: readonly string[];
  readonly changed: boolean;
}

export interface ImpactReport {
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly rows: readonly ImpactRow[];
  readonly changedCount: number;
  readonly newlyReviewedCount: number;
}

/**
 * Replays the same cases under two policy versions before a rule change ships,
 * so the business can see exactly which requests would be treated differently.
 */
export function compareUnderPolicies(
  from: ApprovalPolicy,
  to: ApprovalPolicy,
  cases: readonly { readonly caseId: string; readonly input: PolicyInput }[],
): ImpactReport {
  const rows = cases.map(({ caseId, input }): ImpactRow => {
    const before = evaluatePolicy(from, input).requiredApprovals;
    const after = evaluatePolicy(to, input).requiredApprovals;

    const rulesBefore = new Set(before.flatMap((approval) => approval.ruleIds));
    const rulesAfter = new Set(after.flatMap((approval) => approval.ruleIds));
    const rulesAdded = [...rulesAfter].filter((ruleId) => !rulesBefore.has(ruleId));
    const rulesRemoved = [...rulesBefore].filter((ruleId) => !rulesAfter.has(ruleId));

    const rolesBefore = before.map((approval) => approval.role);
    const rolesAfter = after.map((approval) => approval.role);

    return {
      caseId,
      rolesBefore,
      rolesAfter,
      rulesAdded,
      rulesRemoved,
      changed: rolesBefore.join() !== rolesAfter.join(),
    };
  });

  return {
    fromVersion: from.version,
    toVersion: to.version,
    rows,
    changedCount: rows.filter((row) => row.changed).length,
    newlyReviewedCount: rows.filter(
      (row) => row.rolesBefore.length === 0 && row.rolesAfter.length > 0,
    ).length,
  };
}
