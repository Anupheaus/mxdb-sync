import { createComponent, Flex, Grid, GridColumn } from '@anupheaus/react-ui';
import { addresses, AddressRecord } from '../common';
import { useCollection } from '../../src/client';
import { useAddNewAddressDialog } from './AddNewAddressDialog';

const columns: GridColumn<AddressRecord>[] = [
  { id: 'firstLine', field: 'firstLine', label: 'First Line' },
  { id: 'secondLine', field: 'secondLine', label: 'Second Line' },
  { id: 'city', field: 'city', label: 'City' },
  { id: 'county', field: 'county', label: 'County' },
  { id: 'postcode', field: 'postcode', label: 'Postcode' },
];

export const Addresses = createComponent('Addresses', () => {
  const { gridRequest } = useCollection(addresses);
  const { AddNewAddressDialog, openAddNewAddressDialog } = useAddNewAddressDialog();

  return (
    <Flex tagName="addresses" width={700} height={500}>
      <Grid<AddressRecord>
        columns={columns}
        onRequest={gridRequest()}
        onAdd={openAddNewAddressDialog}
      />
      <AddNewAddressDialog />
    </Flex>
  );
});