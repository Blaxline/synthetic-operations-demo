import { DomainError } from "./errors.ts";

/** Amounts are integer cents. Floating-point currency math is never used. */
export type Cents = number;

export function assertPositiveCents(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new DomainError(
      "invalid_amount",
      `${field} must be a positive integer amount in cents; received ${value}.`,
    );
  }
}

/** Convenience for fixtures and tests: whole or fractional dollars to cents. */
export function dollars(amount: number): Cents {
  return Math.round(amount * 100);
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function formatUsd(cents: Cents): string {
  return usd.format(cents / 100);
}
