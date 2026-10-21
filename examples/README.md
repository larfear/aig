# Synthetic examples

All shared resources use `synthetic: true` and reserved `.invalid` domains. These addresses are fixtures, not live endpoints.

- `resources/`: revision 1 inputs from two generic publishers.
- `scenarios/`: revision 2 update and revision 3 withdrawal of the announcement. Apply them in order to the same stable ID.
- `manifest.json` and `feed.json`: response-format examples; generated live responses reflect the configured origin and current source.

Run `npm run validate:examples` to check all six examples and cross-file consistency. Static examples do not prove an end-to-end publisher or public deployment; see [local development](../docs/local-development.md) and [verification](../docs/verification.md).
