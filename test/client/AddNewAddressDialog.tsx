import { createDialog } from '@anupheaus/react-ui';
import type { AddressRecord } from '../common';

export const useAddNewAddressDialog = createDialog('AddNewAddressDialog', ({ Dialog }) => (address?: AddressRecord) => (
  <Dialog title={address == null ? 'Add New Address' : 'Edit Address'}>
    {/* <DialogContent>

    </DialogContent>
    <DialogAction label="Cancel" action="cancel" />
    <DialogAction label="Save" action="save" /> */}
  </Dialog>
));