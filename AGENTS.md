# Working on AIG

Read README.md and docs/next-steps.md before changes. The latest direct user instruction determines task scope; documentation is not deployment or publication authorization.

- Keep AIG publisher-independent. DOS is an external publisher adapter, not a core dependency. Do not modify or run another publisher project as part of an AIG-only change.
- AIG is a publisher-side gateway. Reuse existing sources where possible; D1 hosted copies are optional to the core. Do not turn it into a content community or recommendation platform.
- Preserve exact original text, provenance, identity, revisions and withdrawal state. Never silently truncate, rewrite or replace content. Consumer interpretation and fact checking are outside scope.
- Prioritize the complete publish/read/update/withdraw path. Retain necessary transport, credential scope, rate and size limits without building speculative security infrastructure.
- Default to synthetic mode and loopback local development. Shared fixtures must use synthetic:true and reserved domains. Tests marked non-synthetic still contain fabricated data.
- Keep credentials, local inputs, databases, certificates, logs and operational receipts in ignored paths. Never copy other projects' credentials or private content into this repository.
- Use npm and package-lock.json. Run checks appropriate to the change; npm run verify covers local contracts, file/D1 behavior, HTTPS fixtures and synthetic lifecycle acceptance.
- Treat local checks, cloud deployment, public reachability and actual publisher adoption as separate evidence. Do not claim one proves the others.
- Public GitHub delivery does not authorize cloud deployment, real-content publication, other-channel sends, new paid services or scheduled operations. CI must remain local-only and require no production secrets.
- A closed Wrangler configuration does not remove an existing Custom Domain. Explicitly remove the intended binding and probe it when shutting down a public test.
