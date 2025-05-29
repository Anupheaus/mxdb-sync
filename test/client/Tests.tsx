import { createComponent, Flex, useBound } from '@anupheaus/react-ui';
import type { AddressRecord } from '../common';
import { addresses, products } from '../common';
import { useCollection } from '../../src/client';
import { useState } from 'react';
import { Test } from './Test';

const newAddress: AddressRecord = {
  id: 'ce118d9d-edae-4937-8fdd-fe8240272529',
  firstLine: '123 Main St',
  secondLine: 'Apt 1',
  city: 'Any town',
  county: 'Any county',
  postcode: '12345',
};

export const Tests = createComponent('Tests', () => {
  const { get, remove, query, upsert, find } = useCollection(addresses);
  const { distinct: distinctProducts } = useCollection(products);
  const [getRecordWasSuccessful, setGetRecordWasSuccessful] = useState<boolean>();
  const [getDistinctWasSuccessful, setGetDistinctWasSuccessful] = useState<boolean>();
  const [isBusy, setIsBusy] = useState(false);
  const [removeRecordWasSuccessful, setRemoveRecordWasSuccessful] = useState<boolean>();
  const [getQueryWasSuccessful, setQueryWasSuccessful] = useState<boolean>();
  const [getUpsertWasSuccessful, setUpsertWasSuccessful] = useState<boolean>();
  const [getFindWasSuccessful, setFindWasSuccessful] = useState<boolean>();

  const testGet = useBound(async () => {
    setIsBusy(true);
    setGetRecordWasSuccessful(false);
    let result = await get('f67089d8-f658-4db0-919d-e6235fe3ead6');
    if (result == null) {
      setGetRecordWasSuccessful(false);
    } else {
      await remove('f67089d8-f658-4db0-919d-e6235fe3ead6', { locallyOnly: true });
      result = await get('f67089d8-f658-4db0-919d-e6235fe3ead6', { locallyOnly: true });
      if (result != null) {
        setGetRecordWasSuccessful(false);
      } else {
        result = await get('f67089d8-f658-4db0-919d-e6235fe3ead6');
        setGetRecordWasSuccessful(result != null);
      }
    }
    setIsBusy(false);
  });

  const testRemove = useBound(async () => {
    setIsBusy(true);
    setRemoveRecordWasSuccessful(false);
    await upsert(newAddress);
    let record = await get(newAddress.id);
    if (record == null) {
      setRemoveRecordWasSuccessful(false);
    } else {
      const result = await remove(newAddress.id);
      if (result === false) {
        setRemoveRecordWasSuccessful(false);
      } else {
        record = await get(newAddress.id);
        setRemoveRecordWasSuccessful(record == null);
      }
    }
    setIsBusy(false);
  });

  const testDistinct = useBound(async () => {
    setIsBusy(true);
    setGetDistinctWasSuccessful(false);
    const result = await distinctProducts('material');
    setGetDistinctWasSuccessful(result.length > 0);
    setIsBusy(false);
  });

  const testQuery = useBound(async () => {
    setIsBusy(true);
    setQueryWasSuccessful(false);
    const { records, total } = await query({ filters: { id: 'f67089d8-f658-4db0-919d-e6235fe3ead6' } });
    setQueryWasSuccessful(records.length > 0 && total === 1);
    setIsBusy(false);
  });

  const testUpsert = useBound(async () => {
    setIsBusy(true);
    setUpsertWasSuccessful(false);
    await remove(newAddress.id);
    let result = await get(newAddress.id);
    if (result != null) {
      setUpsertWasSuccessful(false);
    } else {
      await upsert(newAddress);
      result = await get(newAddress.id);
      setUpsertWasSuccessful(result != null);
    }
    setIsBusy(false);
  });

  const testFind = useBound(async () => {
    setIsBusy(true);
    setFindWasSuccessful(false);
    const result = await find({ id: 'f67089d8-f658-4db0-919d-e6235fe3ead6' });
    setFindWasSuccessful(result != null);
    setIsBusy(false);
  });

  return (
    <Flex isVertical gap="fields" disableGrow>
      <Test isBusy={isBusy} result={removeRecordWasSuccessful} onTest={testRemove}>Test Remove</Test>
      <Test isBusy={isBusy} result={getRecordWasSuccessful} onTest={testGet}>Test Get</Test>
      <Test isBusy={isBusy} result={getDistinctWasSuccessful} onTest={testDistinct}>Test Distinct</Test>
      <Test isBusy={isBusy} result={getQueryWasSuccessful} onTest={testQuery}>Test Query</Test>
      <Test isBusy={isBusy} result={getUpsertWasSuccessful} onTest={testUpsert}>Test Upsert</Test>
      <Test isBusy={isBusy} result={getFindWasSuccessful} onTest={testFind}>Test Find</Test>
    </Flex>
  );
});

