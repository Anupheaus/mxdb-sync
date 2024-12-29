import type { TableColumn } from '@anupheaus/react-ui';
import { createComponent, Flex, Table, useBound } from '@anupheaus/react-ui';
import type { AddressRecord } from '../common';
import { addresses } from '../common';
import { useCollection } from '../../src/client';
import { useAddNewAddressDialog } from './AddNewAddressDialog';

const columns: TableColumn<AddressRecord>[] = [
  { id: 'firstLine', field: 'firstLine', label: 'First Line' },
  { id: 'secondLine', field: 'secondLine', label: 'Second Line' },
  { id: 'city', field: 'city', label: 'City' },
  { id: 'county', field: 'county', label: 'County' },
  { id: 'postcode', field: 'postcode', label: 'Postcode' },
];

export const Addresses = createComponent('Addresses', () => {
  const { gridRequest } = useCollection(addresses);
  // const { AddNewAddressDialog, openAddNewAddressDialog } = useAddNewAddressDialog();

  // const onAdd = useBound(() => { openAddNewAddressDialog(); });

  return (
    <Flex tagName="addresses" width={700} height={500}>
      <Table<AddressRecord>
        columns={columns}
        onRequest={gridRequest()}
      // onAdd={onAdd}
      />
      {/* <AddNewAddressDialog /> */}
    </Flex>
  );
});