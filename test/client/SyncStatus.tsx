import { createComponent, Flex } from '@anupheaus/react-ui';
import { useMXDB } from '../../src/client';

export const SyncStatus = createComponent('SyncStatus', () => {
  const { isSynchronising } = useMXDB();

  return (
    <Flex disableGrow>
      Syncing: {isSynchronising ? 'Yes' : 'No'}
    </Flex>
  );
});
