import consola from 'consola';
import QRCode from 'qrcode';

import { database } from '../../db';

const responseText = (body: string, status = 200): Response =>
  new Response(body, { status });

export const handleQrRegistrationCodeWebRequest = async (
  request: Request,
  registrationId: string,
): Promise<Response> => {
  consola.debug(`Generating QR code for registration ${registrationId}`);

  const registration = await database.query.eventRegistrations.findFirst({
    columns: {
      id: true,
      tenantId: true,
    },
    where: { id: registrationId },
  });

  if (!registration) {
    return responseText('Registration not found', 404);
  }

  const tenant = await database.query.tenants.findFirst({
    columns: {
      domain: true,
    },
    where: { id: registration.tenantId },
  });

  if (!tenant) {
    return responseText('Tenant not found', 404);
  }

  try {
    const requestUrl = new URL(request.url);
    const protocol = requestUrl.protocol.slice(0, -1);
    const scanTargetUrl = `${protocol}://${tenant.domain}/scan/registration/${registration.id}`;

    const imageBuffer = await QRCode.toBuffer(scanTargetUrl, {
      errorCorrectionLevel: 'H',
      type: 'png',
      width: 200,
    });
    const imageBytes = new Uint8Array(imageBuffer);

    return new Response(imageBytes, {
      headers: {
        'Content-Type': 'image/png',
      },
      status: 200,
    });
  } catch (error) {
    consola.error(error);
    return responseText('Failed to generate QR code', 500);
  }
};
