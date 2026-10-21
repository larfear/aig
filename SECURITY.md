# Security reports

AIG is an early implementation with a draft contract. Public resources are intentionally readable without credentials; publishing, updating and withdrawing require a scoped publisher token.

For a vulnerability, use **Security → Report a vulnerability** on [larfear/aig](https://github.com/larfear/aig/security). Do not include tokens, private content or exploitable operational details in public issues. A minimal reproduction using synthetic content is preferred. There is no guaranteed response time or paid bounty program.

For a leaked credential on your deployment, revoke or rotate it with your operator. Removing a value from the latest Git revision does not remove it from existing history or copies.

Instance operators control HTTPS, secrets, domain bindings, storage, usage and billing. Rate limits are basic protection; they are not a global quota or a fixed spending cap. Withdrawal stops current public delivery but does not physically erase private revision history or consumer copies.

See the [hosted-copy module](docs/hosting-addon.md) and [deployment guide](docs/prelaunch-local.md) for the implemented boundaries.
