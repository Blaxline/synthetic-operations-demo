import { formatUsd } from "../domain/money.ts";
import type { BusinessEvent } from "../observability/business-events.ts";

const write = (line = "") => process.stdout.write(`${line}\n`);

export function banner(title: string): void {
  write();
  write("SYNTHETIC DEMONSTRATION");
  write("Invented company, people, vendors and amounts. Not a customer outcome.");
  write();
  write(title);
  write("=".repeat(title.length));
}

export function section(title: string): void {
  write();
  write(title);
  write("-".repeat(title.length));
}

export function line(text: string): void {
  write(`  ${text}`);
}

export function table(headers: readonly string[], rows: readonly (readonly string[])[]): void {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? "").length)),
  );
  const format = (cells: readonly string[]) =>
    `  ${cells.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join("   ")}`.trimEnd();

  write(format(headers));
  write(format(widths.map((width) => "-".repeat(width))));
  for (const row of rows) write(format(row));
}

export function describeEvent(event: BusinessEvent): string {
  switch (event.type) {
    case "request.submitted":
      return `submitted ${formatUsd(event.data.amountCents)} ${event.data.category}; policy ${event.data.policyVersion} requires ${event.data.requiredRoles.join(" + ") || "no review"}${event.data.ruleIds.length ? ` (${event.data.ruleIds.join(", ")})` : ""}`;
    case "request.approval_recorded":
      return `approved as ${event.data.role}`;
    case "request.approved":
      return event.data.automatic
        ? `approved automatically under policy ${event.data.policyVersion}`
        : `fully approved under policy ${event.data.policyVersion}`;
    case "request.rejected":
      return `rejected: ${event.data.reason}`;
    case "erp.posting_attempted":
      return `ERP attempt ${event.data.attempt} (key ${event.data.idempotencyKey})`;
    case "erp.posting_succeeded":
      return event.data.replayed
        ? `ERP recognized the key and returned ${event.data.documentNumber}; no duplicate created`
        : `ERP created ${event.data.documentNumber}`;
    case "erp.posting_failed":
      return `ERP ${event.data.failure} failure: ${event.data.message}${event.data.nextAttemptAt ? ` Retry at ${time(event.data.nextAttemptAt)}.` : ""}`;
    case "request.needs_attention":
      return `NEEDS ATTENTION: ${event.data.reason}`;
    case "request.exception_resolved":
      return `exception resolved (${event.data.resolution}): ${event.data.note}`;
  }
}

export function auditTrail(events: readonly BusinessEvent[]): void {
  table(
    ["#", "when (UTC)", "actor", "what happened"],
    events.map((event) => [
      String(event.sequence),
      `${event.occurredAt.slice(0, 10)} ${time(event.occurredAt)}`,
      event.actorId,
      describeEvent(event),
    ]),
  );
}

function time(iso: string): string {
  return iso.slice(11, 16);
}
