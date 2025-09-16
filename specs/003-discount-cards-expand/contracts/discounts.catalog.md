# Contract: discounts.catalog (Provider Catalog)

- Method: tRPC query `discounts.getTenantProviders`
- Input: none
- Output: Array of `{ type: 'esnCard', status: 'enabled'|'disabled', config: object }`
- Notes: Normalized against hard‑coded catalog. Future providers extend union.
