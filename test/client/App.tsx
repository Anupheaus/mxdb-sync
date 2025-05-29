import { createComponent, Dialogs, Flex } from '@anupheaus/react-ui';
import { MXDBSync } from '../../src/client';
import { collections } from '../common';
import { Addresses } from './Addresses';
import { ConnectionTest } from './ConnectionTest';
import { ClientId } from './ClientId';
import { Tests } from './Tests';
import { SyncStatus } from './SyncStatus';

export const App = createComponent('App', () => {
  return (
    <Dialogs>
      <MXDBSync name="mxdb-sync-test" collections={collections}>
        <Flex gap="fields">
          <Flex gap="fields" isVertical disableGrow>
            <ClientId />
            <SyncStatus />
            <ConnectionTest />
            <Addresses />
          </Flex>
          <Tests />
        </Flex>
      </MXDBSync>
    </Dialogs>
  );
});
