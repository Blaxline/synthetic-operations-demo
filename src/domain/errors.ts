export type DomainErrorCode =
  | "invalid_amount"
  | "invalid_transition"
  | "separation_of_duties"
  | "missing_role"
  | "approval_not_required"
  | "duplicate_request"
  | "not_found"
  | "concurrent_modification";

/**
 * A rule of the operation was violated. The code is stable and meant for
 * callers; the message is meant for the person who has to act on it.
 */
export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}
