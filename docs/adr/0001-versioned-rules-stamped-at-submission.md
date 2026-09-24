# ADR 0001: Versioned rules, stamped at submission

- Status: Accepted
- Date: 2026-09-24

## Context

Approval policy changes while requests are in flight. If a request were re-evaluated against whatever policy is current when an approver opens it, three things break:

- An approver can find the required approvals changed under them mid-review.
- The audit trail can no longer explain why a request was treated the way it was.
- A rule change cannot be assessed before it ships, because its effect depends on timing.

## Decision

- A policy is data: a version, an effective instant, and a list of rules with stable ids.
- Evaluation is a pure function of the policy and the request. It returns the required roles *and* the rule ids that required them.
- The policy in effect at submission is resolved once and its version is stamped on the request. Approvals are checked against the stamped requirements, never re-evaluated.
- Separation of duties is not a policy rule. It is a domain invariant that no version can relax.

## Consequences

- Any decision can be explained after the fact from the request alone.
- A change can be replayed against historical inputs before release (`pnpm demo:impact`), including a check that no request loses a review it had before.
- Requests submitted just before a change follow the old policy until they complete. If a change must apply retroactively, that is an explicit migration with its own audit event, not a side effect.
