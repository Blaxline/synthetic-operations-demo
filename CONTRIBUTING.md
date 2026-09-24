# Contributing

This repository is a demonstration maintained by Blaxline. Issues that point out an error, an unclear explanation or an unhandled edge case are welcome.

Before opening a pull request:

- Open an issue first for anything beyond a small fix, so the scope can be agreed.
- Keep the demo runnable with `pnpm install && pnpm demo`. New runtime dependencies are not accepted.
- Add or update tests for any behavior you change, and run `pnpm verify`.
- Keep all data synthetic. Do not add real company, vendor or personal data.

Patterns are discussed and documented in [business-software-patterns](https://github.com/Blaxline/business-software-patterns); this repository implements them.
