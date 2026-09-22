# Attach the first payment account

The private worker operation attaches an account only to an organization with no existing account, payment history, unfinished payment work, paid event or template configuration, or tax configuration. The account must have completed details and support both charges and payouts. Attached accounts cannot be changed or disconnected. Multiple organizations may share one account.

Use reviewed Terraform output for the intended environment and the matching `SCW_DEFAULT_PROJECT_ID`. The private worker must run in HTTP trigger mode. Send a JSON object through standard input to `ops/scaleway/invoke-private-container.sh <platform-output.json> worker /internal/worker/payment-setup`; do not put the body or credentials in command arguments or logs.

The body contains `organizationId`, `expectedOrganizationDomain`, `accountId`, `confirmation` set to `attach-payment-account`, and a human-readable `reason`. The reason must omit account identifiers. The operation checks the exact normalized domain, locks the organization, repeats the persisted configuration checks, and writes the account and audit entry in one transaction. A rejected result reports `attached: false` and its reason; it does not alter the organization. Review rejection evidence before another attempt.

Browser settings report whether an account is configured. This is the stored setup state, not a live health check of the payment provider. Operators must investigate account availability separately if later provider calls fail.
