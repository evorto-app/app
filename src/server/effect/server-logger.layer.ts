import { Logger } from 'effect';

export const serverLoggerLayer = Logger.replace(
  Logger.defaultLogger,
  Logger.prettyLoggerDefault,
);
