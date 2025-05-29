import { defineCollection } from '../../../src/common';
import { faker } from '@faker-js/faker';

export interface AddressRecord {
  id: string;
  firstLine: string;
  secondLine: string;
  city: string;
  county: string;
  postcode: string;
}

export namespace AddressRecord {
  export const create = (): AddressRecord => ({
    id: Math.uniqueId(),
    firstLine: '',
    secondLine: '',
    city: '',
    county: '',
    postcode: '',
  });
}

export const officeAddress: AddressRecord = {
  id: 'f67089d8-f658-4db0-919d-e6235fe3ead6',
  firstLine: 'Unit 5, 227 Derby Road',
  secondLine: 'Chaddesden',
  city: 'Derby',
  county: 'Derbyshire',
  postcode: 'DE21 6SY',
};

const totalRequired = 10;

export const addresses = defineCollection<AddressRecord>({
  name: 'addresses',
  indexes: [],
  version: 1,
  onSeed: async useCollection => {
    const { upsert, getRecordCount } = useCollection(addresses);
    const recordCount = await getRecordCount();
    if (recordCount >= totalRequired) return;
    await upsert([
      officeAddress,
      ...Array.ofSize(totalRequired - recordCount - 1).map((): AddressRecord => ({
        id: faker.string.uuid(),
        firstLine: faker.location.streetAddress(),
        secondLine: faker.location.secondaryAddress(),
        city: faker.location.city(),
        county: faker.location.county(),
        postcode: faker.location.zipCode(),
      })),
    ]);
  },
});

