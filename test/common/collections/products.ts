import { defineCollection } from '../../../src/common';

export interface ProductRecord {
  id: string;
  name: string;
  type: string;
  material: string;
  price: number;
}

export namespace ProductRecord {
  export const create = (): ProductRecord => ({
    id: Math.uniqueId(),
    name: '',
    type: '',
    material: '',
    price: 0,
  });
}

export const products = defineCollection<ProductRecord>({
  name: 'products',
  indexes: [],
  version: 1,
});

