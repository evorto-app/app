---
default: minor
---

# Search templates by title

Add a search button beside **Event templates**. It replaces the list title and actions with a focused **Search templates** field that filters templates by title (case-insensitive, ignoring surrounding spaces) while keeping the category grouping, hides categories without a match, and shows a message when nothing matches. **Clear** empties the field and keeps focus; **Back** or **Escape** closes search and restores the header, the full list and the previous scroll position. A status message announces the number of matches to screen readers. The filter runs on the already loaded list; no API change.
