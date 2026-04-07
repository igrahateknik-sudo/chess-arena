# Contributing

Thanks for contributing to Chess Arena.

## Development Setup

1. Install dependencies:
   - `cd chess-backend && npm ci`
   - `cd ../chess-app && npm ci`
2. Configure environment variables using:
   - `chess-backend/.env.example`
   - `chess-app/.env.local` (local only, never commit secrets)
3. Run locally:
   - Backend: `cd chess-backend && npm run dev`
   - Frontend: `cd chess-app && npm run dev`

## Branch and PR Rules

- Create feature branches from `main`.
- Keep PRs focused and small.
- Add or update tests for behavior changes.
- Ensure CI passes before requesting review.

## Commit Message Style

Use concise conventional prefixes:

- `feat:` new behavior
- `fix:` bug fix
- `refactor:` internal cleanup
- `test:` tests only
- `docs:` documentation only
- `chore:` maintenance

## Quality Checklist

Before opening a PR:

- Backend: `cd chess-backend && npm test`
- Frontend: `cd chess-app && npm run lint && npm run build`
- No secrets in commits or PR descriptions
- Update docs when changing APIs or workflows
