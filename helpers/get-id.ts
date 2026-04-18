import { randHexaDecimal } from '@ngneat/falso';

export const getId = () => randHexaDecimal({ length: 20 }).join('');
