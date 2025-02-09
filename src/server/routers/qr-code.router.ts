import consola from 'consola';
import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { PassThrough } from 'node:stream';
import QRCode from 'qrcode';

import { database } from '../../db';
import * as schema from '../../db/schema';

export const qrCodeRouter = Router();
qrCodeRouter.get('/registration/:registrationId', async (request, response) => {
  const registrationId = request.params.registrationId;
  consola.debug(`Generating QR code for registration ${registrationId}`);
  const registration = await database.query.eventRegistrations.findFirst({
    columns: {
      id: true,
      tenantId: true,
    },
    where: eq(schema.eventRegistrations.id, registrationId),
  });
  if (!registration) {
    response.status(404).send('Registration not found');
    return;
  }
  const tenant = await database.query.tenants.findFirst({
    columns: {
      domain: true,
    },
    where: eq(schema.tenants.id, registration.tenantId),
  });
  if (!tenant) {
    response.status(404).send('Tenant not found');
    return;
  }
  const scanTargetUrl = `${request.protocol}://${tenant.domain}/scan/registration/${registration.id}`;
  const passThrough = new PassThrough();
  try {
    await QRCode.toFileStream(passThrough, scanTargetUrl, {
      errorCorrectionLevel: 'H',
      type: 'png',
      width: 200,
    });
    passThrough.pipe(response);
  } catch (error) {
    consola.error(error);
    response.status(500).send('Failed to generate QR code');
  }
});
