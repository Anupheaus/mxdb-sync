import { faker } from '@faker-js/faker';
import { extendCollection } from '../../src/server';
import { addresses, officeAddress, products } from '../common';
import type { AddressRecord } from '../common/collections/addresses';
import type { ProductRecord } from '../common/collections/products';

const addressesTotalRequired = 10;
const productsTotalRequired = 10;

extendCollection(addresses, {
  onBeforeUpsert({ records, insertedIds, updatedIds }) {
    // eslint-disable-next-line no-console
    console.log('onBeforeUpsert', records, insertedIds, updatedIds);
  },
  onSeed: async seedWith => {
    await seedWith({
      count: addressesTotalRequired,
      fixedRecords: [officeAddress],
      create: (): AddressRecord => ({
        id: faker.string.uuid(),
        firstLine: faker.location.streetAddress(),
        secondLine: faker.location.secondaryAddress(),
        city: faker.location.city(),
        county: faker.location.county(),
        postcode: faker.location.zipCode(),
      }),
    });
  },
});

extendCollection(products, {
  onSeed: async seedWith => {
    await seedWith({
      count: productsTotalRequired,
      create: (): ProductRecord => ({
        id: faker.string.uuid(),
        name: faker.commerce.product(),
        type: faker.commerce.productAdjective(),
        material: faker.commerce.productMaterial(),
        price: parseFloat(faker.commerce.price({ min: 10, max: 150, dec: 2 })),
      }),
    });
  },
});
