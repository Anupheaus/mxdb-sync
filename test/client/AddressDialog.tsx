import {
  createDialog,
  type DialogDefinitionUtils,
  Flex,
  Text,
  useBound,
  useFields,
  useUpdatableState,
} from '@anupheaus/react-ui';
import { AddressRecord } from '../common';

export const AddressDialogDefinition = createDialog(
  'AddressDialog',
  ({ Dialog, Content, Actions, Action }: DialogDefinitionUtils<'cancel' | 'save'>) =>
    (address: AddressRecord | undefined, onSave: (address: AddressRecord) => Promise<void>) => {
      const [localAddress, setLocalAddress] = useUpdatableState<AddressRecord>(
        () => address ?? AddressRecord.create(),
        [address],
      );
      const { Field } = useFields(localAddress, setLocalAddress);

      const save = useBound(async () => {
        await onSave(localAddress);
      });

      return (
        <Dialog title={address == null ? 'Add New Address' : 'Edit Address'}>
          <Content>
            <Flex isVertical gap={'fields'}>
              <Field field="firstLine" component={Text} label="First Line" />
              <Field field="secondLine" component={Text} label="Second Line" />
              <Field field="city" component={Text} label="City" />
              <Field field="county" component={Text} label="County" />
              <Field field="postcode" component={Text} label="Postcode" />
            </Flex>
          </Content>
          <Actions>
            <Action value="cancel">Cancel</Action>
            <Action value="save" onClick={save}>
              Save
            </Action>
          </Actions>
        </Dialog>
      );
    },
);
