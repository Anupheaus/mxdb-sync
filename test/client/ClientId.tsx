import { Button, createComponent, Flex } from '@anupheaus/react-ui';
import { useMXDBSync, useMXDBSignOut } from '../../src/client';
import { useUser } from '@anupheaus/socket-api/client';

export const ClientId = createComponent('ClientId', () => {
  const { clientId } = useMXDBSync();
  const { user } = useUser();
  const signOut = useMXDBSignOut();

  return <Flex isVertical disableGrow>
    <Flex disableGrow>Client ID:&nbsp;{clientId}</Flex>
    <Flex disableGrow valign="center">User ID:&nbsp;{user?.id}&nbsp;<Button onClick={signOut}>Sign Out</Button></Flex>
  </Flex>;
});