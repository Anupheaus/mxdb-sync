import { createComponent, Dialogs, Flex } from '@anupheaus/react-ui';
import { MXDBSync } from '../../src/client';
import { collections } from '../common';
import { Addresses } from './Addresses';
import { ConnectionTest } from './ConnectionTest';
import { ClientId } from './ClientId';

export const App = createComponent('App', () => {
  return (
    <Dialogs>
      <MXDBSync name="test" collections={collections}>
        <Flex gap={'fields'} isVertical disableGrow>
          <ClientId />
          <ConnectionTest />
          <Addresses />
        </Flex>
      </MXDBSync>
    </Dialogs>
  );
});
