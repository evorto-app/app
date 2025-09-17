# Platform Policies

This document captures global policies that apply across features and flows. Keep this file updated as platform-wide decisions evolve.

## Taxes

- The application does not model or calculate taxes explicitly in functional flows.
- All user-visible prices are treated as final (tax-inclusive) amounts.
- The checkout page may display an informational note indicating that prices include tax.
- For reporting purposes only, taxes are associated with registration options (for analytics/compliance exports), but operational logic (e.g., refunds, fees) disregards taxes.
- Fees (app fees, transaction/processor fees) apply to the option price and refund logic considers only the final paid price; taxes are not separately handled.

## Localization

- The platform is English-only; no localization/internationalization is required.
- All UI text, notifications, and documentation are authored and shown in English.

## Notes

- If future requirements introduce jurisdiction-specific tax handling or multi-language support, this document should be updated and relevant specs must be revised to reflect new behaviors and constraints.
