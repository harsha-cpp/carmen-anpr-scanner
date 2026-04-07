# Project Instructions

## Commit Policy

Commit after every small feature, fix, or meaningful change. Do not batch unrelated changes. Use Conventional Commits:

- `feat(scope): ...` for new features
- `fix(scope): ...` for bug fixes
- `refactor(scope): ...` for refactors
- `chore(scope): ...` for config/tooling

Push to origin after each commit unless told otherwise.

## Architecture Constraints

- Do not break the existing ANPR scanner at `/anpr` and `/scanner/`
- Do not break the existing Azure deployment path
- Extend the outbox pattern, do not replace it
- Reuse the existing Better Auth setup
- The `fe/survilience` directory is deprecated — ignore it
