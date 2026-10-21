# AIG · Agent Information Gateway

[![Local verification](https://github.com/larfear/aig/actions/workflows/ci.yml/badge.svg)](https://github.com/larfear/aig/actions/workflows/ci.yml)

**Publish once. Let agents read the same content.**

[简体中文](README.zh-CN.md) · [Publisher guide](docs/publisher-integration.md) · [HTTP contract](docs/access-contract.md) · [Deployment](docs/prelaunch-local.md)

AIG is a publisher-side gateway that delivers selected public content to agents over HTTP and JSON Feed. Keep publishing through your existing tools and channels; expose the same final text, provenance, revision and withdrawal state through an address you control.

AIG preserves the original content. It does not summarize, rewrite, fact-check or judge how a consumer interprets it.

## How it works

```text
Publisher / publishing tool ───────────────────────> Existing channels (X, website, …)
          │
          ├── Existing content source ──> Source adapter ──┐
          │                                               ├──> AIG ──> Agents / clients
          └── Optional hosted copy ─────> D1 adapter ─────┘
```

The core is independent of any publisher or platform. Reuse an existing source where possible. If your content lives only on a local device, the optional Workers + D1 module stores the selected public copy without exposing your local files. The reference adapters are a local file source and Cloudflare D1; arbitrary website/CMS adapters are not included.

## What is implemented

- Anonymous manifest, JSON Feed and full-resource reads.
- Scoped publisher credentials for publish, update and withdraw operations.
- Stable resource IDs, continuous revisions, idempotent retries and explicit conflict responses.
- Exact inline plain text / Markdown, with source metadata and per-resource synthetic markers.
- Withdrawal as an HTTP 410 tombstone, removed from the public Feed.
- Optional D1 persistence, with private revision history for retry handling.
- Local publisher and reader CLIs, plus automated lifecycle acceptance.
- HTTPS target checks, request/response limits and basic authentication/request throttling.

## Status and live instance

**Early reference implementation; contract `0.1-draft`.** Breaking changes remain possible.

The maintainer-operated instance is available at [aig.signalcask.com/manifest.json](https://aig.signalcask.com/manifest.json), with a [public Feed](https://aig.signalcask.com/feed.json). Anonymous manifest, Feed and resource reads were checked on **2026-10-21**. This is a publisher-owned instance, not a public upload service; use your own deployment and credentials to publish.

Local automated checks exercise file/D1 storage, permissions, exact content, retries, updates, restarts and withdrawals. They do not establish global reachability, production load capacity or adoption by other agents. See [verification scope](docs/verification.md) and the [launch note](docs/production-launch-20261021.md).

## Quick start: local hosted copy

Requires **Node.js 24.14+ within 24.x**, npm, Git and OpenSSL. Node 24.14.0 is pinned in `.node-version` and `.nvmrc`. No cloud account or payment is required for local tests.

```sh
git clone https://github.com/larfear/aig.git
cd aig
npm ci
npm run verify
```

Start a local Worker with local D1 and two synthetic publishers:

```sh
npm run setup:local
npm run db:hosting:migrate
npm run dev:hosting
```

In another terminal:

```sh
# Publish revision 1 and read it anonymously.
npm run demo:publish -- --file examples/resources/demo-announcement-001.json --url http://127.0.0.1:8787/
npm run client:read -- --id demo-announcement-001

# Update to revision 2, then withdraw with revision 3.
npm run demo:publish -- --file examples/scenarios/demo-announcement-001-updated.json --url http://127.0.0.1:8787/
npm run demo:publish -- --file examples/scenarios/demo-announcement-001-withdrawn.json --url http://127.0.0.1:8787/
npm run client:read -- --id demo-announcement-001
```

The final read reports a withdrawn resource (HTTP 410), not the old body. Replaying revision 1 does not restore it. Stop the server with Ctrl+C. Local state and generated credentials stay in ignored paths; do not commit them.

For a single automated run, use `npm run acceptance:local`. It starts its own loopback Worker, uses synthetic content, checks five lifecycle read checkpoints, then removes its temporary database and credentials. For a read-only file gateway, see [local development](docs/local-development.md).

## HTTP interface

| Method | Path | Access | Result |
| --- | --- | --- | --- |
| GET | `/manifest.json` | Public | Contract, capabilities and endpoint addresses |
| GET | `/feed.json` | Public | Current published items, JSON Feed 1.1 + `_aig` |
| GET | `/items/{id}.json` | Public | Full resource (200), withdrawal tombstone (410), or error |
| PUT | `/publish/items/{id}.json` | Publisher Bearer token | Publish, update or withdraw one resource |

Submit a complete resource with `Content-Type: application/json`. Successful writes return `stored` or `unchanged`, plus the submitted revision and current revision/status. A known old retry may return `unchanged` while the current resource remains withdrawn. Revisions start at 1 and increment for changes; retries retain the exact payload.

See the [resource Schema](schemas/resource.schema.json), [synthetic inputs](examples/resources/) and [publisher integration guide](docs/publisher-integration.md) for executable requests, configuration and error handling. Writers must be configured by the instance operator; a resource ID or public URL is not a credential.

## Current limits

- Original inline `text/plain` or `text/markdown` is required. Additional URL representations are preserved, not fetched. Binary upload and R2 integration are not implemented.
- Resource/request limit: 256 KiB. Response limit: 2 MiB. D1 Feed: up to 100 active resources. Over-limit responses fail explicitly; pagination is not implemented.
- Default content mode is `synthetic`. `public` must be configured explicitly; individual resources retain their own `synthetic` flag.
- Withdrawal stops public delivery of the body. It does not erase private D1 history or copies already obtained by consumers.
- No search, subscription, MCP server, automatic discovery or multi-region synchronization is included.

## Documentation

| Guide | Contents |
| --- | --- |
| [Architecture and scenarios](docs/project-plan.md) | Source reuse, local content and optional hosting |
| [Publisher integration](docs/publisher-integration.md) | Credentials, modes, payloads, retries and reader acceptance |
| [HTTP contract](docs/access-contract.md) | Resource semantics, status codes and integrity |
| [Local development](docs/local-development.md) | File gateway and local Workers/D1 commands |
| [Deployment preparation](docs/prelaunch-local.md) | Explicit HTTPS target, offline bundle and operator steps |
| [Hosted-copy module](docs/hosting-addon.md) | D1 persistence and operational boundaries |
| [Platform and budget](docs/platform-and-budget.md) | Account requirements and cost assumptions |
| [Testing](docs/verification.md) | What each check proves |
| [Roadmap](docs/next-steps.md) | Current scope and possible extensions |
| [DOS adapter example](docs/dos-integration.md) | A publisher integration example, separate from the core |

The detailed guides are currently in Chinese. Issues and contributions in English or Chinese are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues through [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 larfear.
