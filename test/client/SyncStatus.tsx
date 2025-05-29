import { createComponent, Flex } from '@anupheaus/react-ui';
import { useMXDBSync } from '../../src/client';

export const SyncStatus = createComponent('SyncStatus', () => {
  const { isSynchronising } = useMXDBSync();

  return (
    <Flex disableGrow>
      Syncing: {isSynchronising ? 'Yes' : 'No'}
    </Flex>
  );
});
