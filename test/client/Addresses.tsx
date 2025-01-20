import type { TableColumn } from '@anupheaus/react-ui';
import { createComponent, Flex, Table, useBound } from '@anupheaus/react-ui';
import type { AddressRecord } from '../common';
import { addresses } from '../common';
import { useCollection } from '../../src/client';
import { useAddressDialog } from './AddressDialog';

const columns: TableColumn<AddressRecord>[] = [
  { id: 'firstLine', field: 'firstLine', label: 'First Line' },
  { id: 'secondLine', field: 'secondLine', label: 'Second Line' },
  { id: 'city', field: 'city', label: 'City' },
  { id: 'county', field: 'county', label: 'County' },
  { id: 'postcode', field: 'postcode', label: 'Postcode' },
];

export const Addresses = createComponent('Addresses', () => {
  const { gridRequest, upsert, remove } = useCollection(addresses);
  const { AddressDialog, openAddressDialog } = useAddressDialog();

  const onAdd = useBound(async () => { await openAddressDialog(undefined, upsert); });

  const onEdit = useBound(async (address: AddressRecord) => { await openAddressDialog(address, upsert); });

  const onRemove = useBound(async (address: AddressRecord) => { await remove(address.id); });

  return (
    <Flex tagName="addresses" width={700} height={500}>
      <Table<AddressRecord>
        columns={columns}
        onRequest={gridRequest()}
        onEdit={onEdit}
        onAdd={onAdd}
        onRemove={onRemove}
      />
      <AddressDialog />
    </Flex>
  );
});