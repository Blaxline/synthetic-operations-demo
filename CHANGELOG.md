# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-09-24

### Added

- Purchase approval workflow with explicit states and separation of duties.
- Approval policies 1.0 and 1.1 as versioned rules, stamped at submission.
- Impact replay of a policy change against historical requests.
- ERP posting job with idempotency keys, failure classification, capped backoff and exception handling.
- Append-only business events, audit trail and derived value signals.
- Runnable demonstrations: `pnpm demo` and `pnpm demo:impact`.
