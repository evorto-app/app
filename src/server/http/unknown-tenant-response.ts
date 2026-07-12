import * as HttpServerResponse from 'effect/unstable/http/HttpServerResponse';

export const unknownTenantDocument = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Tenant link not found | Evorto</title>
    <style>
      :root {
        color-scheme: light;
        font-family:
          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
          "Segoe UI", sans-serif;
        background: #eef3f5;
        color: #182023;
      }

      * {
        box-sizing: border-box;
      }

      body {
        display: grid;
        min-height: 100dvh;
        margin: 0;
        place-items: center;
        padding: clamp(1rem, 4vw, 3rem);
      }

      main {
        width: min(100%, 42rem);
        border-top: 0.3rem solid #006879;
        background: #f8fafb;
        padding: clamp(1.5rem, 5vw, 3.5rem);
      }

      .eyebrow {
        margin: 0 0 1.25rem;
        color: #006879;
        font-size: 0.75rem;
        font-weight: 700;
        letter-spacing: 0.09em;
        text-transform: uppercase;
      }

      h1 {
        max-width: 18ch;
        margin: 0;
        font-size: clamp(2rem, 7vw, 3.5rem);
        font-weight: 500;
        letter-spacing: -0.035em;
        line-height: 1.05;
      }

      .lead {
        max-width: 58ch;
        margin: 1.5rem 0 2.25rem;
        color: #3f484c;
        font-size: 1.05rem;
        line-height: 1.65;
      }

      h2 {
        margin: 0 0 0.75rem;
        font-size: 1rem;
        font-weight: 700;
      }

      ol {
        display: grid;
        margin: 0;
        padding-left: 1.25rem;
        gap: 0.75rem;
        line-height: 1.55;
      }

      .note {
        margin: 2rem 0 0;
        border-left: 0.2rem solid #596d73;
        padding-left: 1rem;
        color: #3f484c;
        font-size: 0.9rem;
        line-height: 1.55;
      }

      @media (prefers-color-scheme: dark) {
        :root {
          color-scheme: dark;
          background: #101416;
          color: #e0e4e6;
        }

        main {
          background: #191c1e;
        }

        .eyebrow {
          color: #82d3e6;
        }

        .lead,
        .note {
          color: #bec8cc;
        }

        .note {
          border-left-color: #9fb2b8;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <p class="eyebrow">Evorto</p>
      <h1>This link does not match an Evorto tenant</h1>
      <p class="lead">
        Evorto could not find an organization for this web address. Your
        account and registrations have not been changed.
      </p>

      <h2>What to do</h2>
      <ol>
        <li>Open the complete link from your latest event email or invitation.</li>
        <li>Check the address for a missing or misspelled tenant name.</li>
        <li>Ask the event organizer for the tenant's current Evorto link.</li>
      </ol>

      <p class="note">
        If a QR code brought you here, do not edit its address or create a new
        registration. Ask an organizer to confirm that the code still points to
        the tenant's current domain.
      </p>
    </main>
  </body>
</html>`;

export const createUnknownTenantResponse = (method: string) =>
  HttpServerResponse.text(method === 'HEAD' ? '' : unknownTenantDocument, {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/html; charset=utf-8',
      'X-Robots-Tag': 'noindex, nofollow',
    },
    status: 404,
  });
