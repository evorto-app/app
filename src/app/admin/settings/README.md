# Organization settings

Appearance owns the optional Home navigation link alongside branding, theme,
footer links, and search metadata. `tenants.home_page_url = null` means no home
page; a validated absolute HTTP/HTTPS URL adds Home for visitors and members,
opening in a separate tab. There is no hosted home-page editor or content mode.

Keep the Home URL in the appearance conflict snapshot and public tenant config.
Saving requires `admin:changeSettings`; use the existing tenant lock and settings
readback flow. Apply the additive nullable column before releasing the app.
