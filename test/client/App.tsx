import { createComponent, Dialogs, Flex } from '@anupheaus/react-ui';
import { MXDBSync, useMXDBAuth } from '../../src/client';
import { collections } from '../common';
import { Addresses } from './Addresses';
import { ConnectionTest } from './ConnectionTest';
import { ClientId } from './ClientId';
import { Tests } from './Tests';
import { SyncStatus } from './SyncStatus';
import { Registration } from './Registration';

const AppContent = createComponent('AppContent', () => {
  const { isAuthenticated } = useMXDBAuth();

  if (!isAuthenticated) return <Registration />;

  return (
    <Flex gap="fields">
      <Flex gap="fields" isVertical disableGrow>
        <ClientId />
        <SyncStatus />
        <ConnectionTest />
        <Addresses />
      </Flex>
      <Tests />
    </Flex>
  );
});

export const App = createComponent('App', () => {
  return (
    <Dialogs>
      <MXDBSync name="mxdb-sync-test" collections={collections}>
        <AppContent />
      </MXDBSync>
    </Dialogs>
  );
});
