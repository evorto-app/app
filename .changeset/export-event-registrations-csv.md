---
default: patch
---

# Export event registrations as CSV

- let organizers download an event's registrations as a CSV file from the organize page,
- serve it on demand from an authenticated download URL with the same access rule as the organize overview,
- include name, email, registration option, organizer flag, status, check-in state and time, and one column per registration question,
- escape cells that spreadsheet programs would run as formulas.
