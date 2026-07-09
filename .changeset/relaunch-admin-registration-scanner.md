# Tighten relaunch admin, registration, and scanner behavior

- add tenant-scoped existing-user role assignment behind `users:assignRoles`
- hide Scanner navigation unless the user can scan through permissions or an active organizing registration today
- expose manual approval as the supported non-FCFS registration mode while rejecting unsupported random allocation on write paths
- add tenant operations settings for email sender, Stripe account id, and active registration limits
- require Resend delivery config at startup and send configured tenant emails for manual approval outcomes and receipt review results
