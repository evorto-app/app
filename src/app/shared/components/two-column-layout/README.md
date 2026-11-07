# Two-column layout

Use `TwoColumnLayoutComponent` for list/detail or navigation/detail routes.
Project the page’s existing content into `twoColumnHeader`, `twoColumnSidebar`,
optional `twoColumnFooter`, and `twoColumnDetail` slots. Empty optional slots
consume no space. Keep page content, permissions, and route activation in the
owning component.

Set `detailActive` to hide the sidebar on small screens when a child page is open.
Leave it false on a profile overview that shows navigation and account details.
The left header remains visible while its navigation scrolls on desktop.

The default keeps normal document scrolling, with a sticky, viewport-limited
sidebar. Its maximum height leaves room for the desktop organization footer and
page padding, so reaching the end of the document does not push the header out
of view. Long sidebars scroll without losing their header. Use
`independentScroll` for full-height desktop lists: the app shell reserves space
for the organization footer, and the list and detail scroll independently.
The parent page host must fill its parent with `lg:h-full lg:min-h-0`.
Do not add another viewport height. Detail padding scrolls away with content.

`sidebarWidth` supports the existing 300px settings, 380px template, and 400px
event layouts. Give independently scrolling regions meaningful `sidebarLabel`
and `detailLabel` values so keyboard and screen-reader users can identify them.
Independent scroll panes remain keyboard-focusable so arrow and Page Down keys can scroll them. Their focus outline is shown for keyboard focus, not pointer clicks.

The shared layout owns spacing and scroll containers; projected content should
not repeat its desktop padding, mobile hiding, or overflow styles.

Sizing, header positioning, overflow, and mobile visibility use CSS and work in
server-rendered HTML with browser JavaScript disabled. Keep navigation as real
`routerLink` anchors with an `href`, so links can trigger a server-rendered page
load before hydration or without JavaScript. Route activation determines the
initial mobile list/detail state on the server as well as in the client.

For route data, use `holdServerRenderWhile` at the page/service boundary for
always-enabled queries needed by the initial HTML. HTTP completion can happen
before query results reach Angular's signals; the rendering hold must last until
the result is available or the query fails. This data concern stays outside the
layout component. Do not include intentionally disabled pending queries.
