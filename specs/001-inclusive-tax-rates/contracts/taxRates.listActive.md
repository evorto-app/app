# Contract: taxRates.listActive

Purpose: Provide creators (and optionally anonymous) with compatible imported tax rates.

Auth: Optional. If authenticated, requires `templates:view`. Anonymous allowed.

Input Schema:

```
{}
```

Output Schema (array ordered by displayName asc, stripeTaxRateId asc):

```
[
  {
    stripeTaxRateId: string,
    displayName: string,
    percentage: string
  }, ...
]
```

Filter: inclusive=true AND active=true

Errors:

- PERMISSION_DENIED (if authenticated but lacks permission)
