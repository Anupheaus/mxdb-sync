import { createComponent, Flex } from '@anupheaus/react-ui';
import { useMXDBSync } from '../../src/client';

export const ClientId = createComponent('ClientId', () => {
  const { clientId } = useMXDBSync();
  return <Flex disableGrow>Client ID:&nbsp;{clientId}</Flex>;
});