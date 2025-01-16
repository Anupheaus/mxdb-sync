import { createDialog, Flex, Text, useBound, useFields, useUpdatableState } from '@anupheaus/react-ui';
import { AddressRecord } from '../common';

export const useAddressDialog = createDialog('AddressDialog', ({ Dialog, Content, Actions, Action, close }) => (address: AddressRecord | undefined, onSave: (address: AddressRecord) => Promise<void>) => {
  const [localAddress, setLocalAddress] = useUpdatableState<AddressRecord>(() => address ?? AddressRecord.create(), [address]);
  const useField = useFields(localAddress, setLocalAddress);
  const { firstLine, setFirstLine } = useField('firstLine');
  const { secondLine, setSecondLine } = useField('secondLine');
  const { city, setCity } = useField('city');
  const { county, setCounty } = useField('county');
  const { postcode, setPostcode } = useField('postcode');

  const cancel = useBound(() => { close('cancel'); });
  const save = useBound(async () => { await onSave(localAddress); close('save'); });

  return (
    <Dialog title={address == null ? 'Add New Address' : 'Edit Address'}>
      <Content>
        <Flex isVertical gap={'fields'}>
          <Text label="First Line" value={firstLine} onChange={setFirstLine} wide />
          <Text label="Second Line" value={secondLine} onChange={setSecondLine} wide />
          <Text label="City" value={city} onChange={setCity} wide />
          <Text label="County" value={county} onChange={setCounty} wide />
          <Text label="Postcode" value={postcode} onChange={setPostcode} wide />
        </Flex>
      </Content>
      <Actions>
        <Action value="cancel" onClick={cancel}>Cancel</Action>
        <Action value="save" onClick={save}>Save</Action>
      </Actions>
    </Dialog>
  );
});