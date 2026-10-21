# Contributing to AIG

AIG is an early publisher-side gateway with a draft contract. Small, reproducible improvements to publishing, exact reads, updates, withdrawals and source adapters are welcome. Issues and pull requests may be written in English or Chinese.

## Local setup

Use Node 24.14+ within 24.x, npm, Git and OpenSSL:

```sh
npm ci
npm run verify
```

All verification runs locally with fabricated content. No cloud credentials, paid account, live publisher or production endpoint is required. See [local development](docs/local-development.md).

## Changes

1. Describe the concrete problem and expected behavior in an issue or pull request.
2. Keep the core independent of a particular publisher or social platform.
3. Update the contract, strict JSON Schemas and synthetic examples together when changing the public format.
4. Run relevant checks, then `npm run verify` for changes to the publishing or reading path. Explain any untested behavior.
5. Keep credentials, raw logs, databases and personal content out of patches and issue attachments. Use `.local/` for private working data.

The CI workflow runs local verification only. It has no cloud deployment step. Deployment, live publishing and external-channel sends require separate operator decisions.

For security reports, follow [SECURITY.md](SECURITY.md).

Contributions are provided under the repository’s [MIT license](LICENSE).
