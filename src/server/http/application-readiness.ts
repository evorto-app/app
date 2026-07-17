export const APPLICATION_READINESS_PATH = '/readyz';
export const APPLICATION_READINESS_SSR_PATH = '/events';

const applicationReadinessSsrMarker = /<app-event-list(?:\s|>)/u;
const noStoreHeaders = {
  'Cache-Control': 'no-store',
};

const notReadyResponse = () =>
  Response.json(
    { status: 'not-ready' },
    {
      headers: noStoreHeaders,
      status: 503,
    },
  );

export const createApplicationReadinessSsrRequest = (
  readinessRequest: Request,
  readinessTenantHost?: string,
): Request => {
  const targetUrl = new URL(
    APPLICATION_READINESS_SSR_PATH,
    readinessRequest.url,
  );
  const headers = new Headers(readinessRequest.headers);

  if (readinessTenantHost) {
    targetUrl.host = readinessTenantHost;
    headers.set('host', readinessTenantHost);
  }

  // Always test the public SSR path. A caller's valid session must not hide an
  // authentication redirect or a tenant-host configuration problem.
  headers.delete('authorization');
  headers.delete('cookie');
  headers.delete('x-forwarded-host');
  headers.set('accept', 'text/html');

  return new Request(targetUrl, {
    cache: 'no-store',
    headers,
    method: 'GET',
    redirect: 'manual',
  });
};

export const createApplicationReadinessResponse = async (
  ssrResponse: null | Response,
): Promise<Response> => {
  if (
    !ssrResponse ||
    ssrResponse.status !== 200 ||
    ssrResponse.headers.has('location') ||
    !ssrResponse.headers
      .get('content-type')
      ?.toLowerCase()
      .startsWith('text/html')
  ) {
    return notReadyResponse();
  }

  try {
    const html = await ssrResponse.text();
    if (!applicationReadinessSsrMarker.test(html)) {
      return notReadyResponse();
    }
  } catch {
    return notReadyResponse();
  }

  return new Response(null, {
    headers: noStoreHeaders,
    status: 204,
  });
};
