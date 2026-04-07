# Security Policy

## Supported Versions

Security fixes are prioritized for the `main` branch and latest production deployment.

## Reporting a Vulnerability

Please do not open public issues for security vulnerabilities.

- Contact: `security@chessarena.local` (replace with your real security email)
- Include:
  - affected endpoint/feature
  - reproduction steps
  - impact assessment
  - proof-of-concept (if available)

We aim to acknowledge reports within 72 hours and provide status updates regularly.

## Disclosure Policy

- We investigate and validate reports privately.
- We coordinate a fix and deployment before public disclosure.
- We may request a reasonable embargo period for user safety.

## Security Best Practices for Contributors

- Never commit secrets (`.env`, API keys, tokens, credentials).
- Use environment variables for sensitive configuration.
- Prefer least-privilege credentials for third-party services.
- Add tests for security-sensitive code paths where possible.
