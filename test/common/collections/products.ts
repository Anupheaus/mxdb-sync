import { defineCollection } from '../../../src/common';
import { faker } from '@faker-js/faker';

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

const totalRequired = 10;

export const products = defineCollection<ProductRecord>({
  name: 'products',
  indexes: [],
  version: 1,
  onSeed: async useCollection => {
    const { upsert, getRecordCount } = useCollection(products);
    const recordCount = await getRecordCount();
    if (recordCount >= totalRequired) return;

    await upsert(Array.ofSize(totalRequired - recordCount).map((): ProductRecord => ({
      id: faker.string.uuid(),
      name: faker.commerce.product(),
      type: faker.commerce.productAdjective(),
      material: faker.commerce.productMaterial(),
      price: parseFloat(faker.commerce.price({ min: 10, max: 150, dec: 2 })),
    })));
  },
});

