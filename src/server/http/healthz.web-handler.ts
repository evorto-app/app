export const handleHealthzWebRequest = async (): Promise<Response> =>
  Response.json({
    status: 'ok',
    uptime: process.uptime(),
  });
