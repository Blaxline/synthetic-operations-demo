# ADR 0003: Ports, in-memory adapters, no runtime dependencies

- Status: Accepted
- Date: 2026-09-24

## Context

The purpose of this repository is to be read and run in minutes. Any setup step (a database, a container, a build) reduces the number of people who will actually run it.

## Decision

- The application depends on ports: a request repository, an event log, an ERP gateway, a clock and a people directory.
- The demo uses in-memory adapters. The repository enforces optimistic concurrency and returns copies, so it behaves like a real store at the boundary that matters.
- There are no runtime dependencies. TypeScript is executed natively by Node.js (type stripping), so the code uses only erasable syntax and there is no build step.
- Tooling is limited to TypeScript for type checking, Vitest for tests and Biome for linting and formatting.

## Consequences

- `pnpm install && pnpm demo` is the whole setup.
- Replacing storage with a relational database means writing new adapters for the repository and event log, and writing the request update and its events in one transaction. The domain and application layers do not change.
- Erasable syntax only: no enums, namespaces or constructor parameter properties.
