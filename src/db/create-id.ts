import { init } from '@paralleldrive/cuid2';

const length = 20;

export const createId = init({ length });
