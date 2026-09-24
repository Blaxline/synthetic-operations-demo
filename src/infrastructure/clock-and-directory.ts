import type { Clock, Directory } from "../application/ports.ts";
import type { Role } from "../domain/purchase-request.ts";

/** Time only moves when the caller moves it, which keeps runs reproducible. */
export class ControlledClock implements Clock {
  #current: Date;

  constructor(start: string) {
    this.#current = new Date(start);
  }

  now(): Date {
    return new Date(this.#current);
  }

  advanceMinutes(minutes: number): void {
    this.#current = new Date(this.#current.getTime() + minutes * 60_000);
  }

  set(at: string): void {
    const next = new Date(at);
    if (next.getTime() < this.#current.getTime()) {
      throw new Error(`Clock cannot move backwards to ${at}.`);
    }
    this.#current = next;
  }
}

export class StaticDirectory implements Directory {
  readonly #roles: ReadonlyMap<string, readonly Role[]>;

  constructor(roles: Record<string, readonly Role[]>) {
    this.#roles = new Map(Object.entries(roles));
  }

  rolesOf(userId: string): readonly Role[] {
    return this.#roles.get(userId) ?? [];
  }
}
