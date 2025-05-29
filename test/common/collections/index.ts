import type { MXDBCollection } from '../../../src/common';
import { addresses } from './addresses';
import { products } from './products';

export * from './addresses';
export * from './products';

export const collections: MXDBCollection[] = [
  addresses,
  products,
];
