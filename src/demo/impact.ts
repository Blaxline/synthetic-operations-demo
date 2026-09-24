/**
 * Before a rule change ships, replay recent requests under both versions and
 * show the business exactly which ones would be treated differently, and why.
 */
import { formatUsd } from "../domain/money.ts";
import { compareUnderPolicies } from "../rules/impact.ts";
import { POLICY_V1, POLICY_V1_1 } from "../rules/versions.ts";
import { HISTORICAL_CASES } from "./fixtures.ts";
import { banner, line, section, table } from "./render.ts";

banner(`Impact of policy ${POLICY_V1.version} -> ${POLICY_V1_1.version} on last month's requests`);

section("Rule changes");
const before = new Set(POLICY_V1.rules.map((rule) => rule.id));
for (const rule of POLICY_V1_1.rules.filter((candidate) => !before.has(candidate.id))) {
  line(`+ ${rule.id}: ${rule.description}`);
}

section("Replay");
const report = compareUnderPolicies(POLICY_V1, POLICY_V1_1, HISTORICAL_CASES);
const inputs = new Map(HISTORICAL_CASES.map((entry) => [entry.caseId, entry.input]));
const roles = (list: readonly string[]) => (list.length ? list.join(" + ") : "none");

table(
  [
    "case",
    "amount",
    "category",
    "new vendor",
    `review ${report.fromVersion}`,
    `review ${report.toVersion}`,
    "changed by",
  ],
  report.rows.map((row) => {
    const input = inputs.get(row.caseId);
    return [
      row.caseId,
      input ? formatUsd(input.amountCents) : "",
      input?.category ?? "",
      input?.vendor.isNew ? "yes" : "no",
      roles(row.rolesBefore),
      roles(row.rolesAfter),
      row.changed ? row.rulesAdded.join(", ") : "",
    ];
  }),
);

section("Summary");
line(
  `${report.changedCount} of ${report.rows.length} requests would follow a different approval path.`,
);
line(
  `${report.newlyReviewedCount} of them ${report.newlyReviewedCount === 1 ? "was" : "were"} previously approved with no human review.`,
);
const loosened = report.rows.filter((row) => row.rulesRemoved.length > 0).length;
line(
  loosened === 0
    ? `No request loses a review it had under ${report.fromVersion}: the change only adds control.`
    : `${loosened} requests would lose a review they had under ${report.fromVersion}. Confirm that is intended.`,
);
