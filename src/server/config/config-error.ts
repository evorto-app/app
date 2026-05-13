import { Config } from 'effect';

export const formatConfigError = (error: unknown) => {
  if (error instanceof Config.ConfigError) {
    return `- ${error.message}`;
  }

  return `- ${error instanceof Error ? error.message : String(error)}`;
};

export const missingFieldError = (name: string) =>
  new Error(`Expected ${name} to be configured`);
