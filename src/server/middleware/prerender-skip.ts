import consola from 'consola';
import { NextFunction, Request, Response } from 'express';

export const prerenderSkip = (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  if (process.env['PRERENDER'] === 'true') {
    consola.warn('Assuming prerender mode');
    response.status(204).send({ message: 'NO CONTEXT ON SERVER' });
    return;
  }
  if (request.header('x-no-context-on-server') === 'true') {
    consola.warn('Assuming prerender mode');
    response.status(204).send({ message: 'NO CONTEXT ON SERVER' });
    return;
  }
  return next();
};
