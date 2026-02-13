import type { Response as ExpressResponse } from 'express';

export const writeWebResponse = async (
  response: ExpressResponse,
  webResponse: globalThis.Response,
) => {
  response.status(webResponse.status);
  for (const [key, value] of webResponse.headers.entries()) {
    response.setHeader(key, value);
  }

  const body = Buffer.from(await webResponse.arrayBuffer());
  response.send(body);
};
