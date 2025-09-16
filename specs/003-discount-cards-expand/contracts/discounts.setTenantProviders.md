# Contract: discounts.setTenantProviders

- Method: tRPC mutation `discounts.setTenantProviders`
- Input: `{ providers: Array<{ type: 'esnCard', status: 'enabled'|'disabled', config: unknown }> }`
- Output: void
- Permissions: `admin:changeSettings`
- Errors: validation errors; unauthorized when missing permission.
