import { Button, createComponent, Flex, useBound } from '@anupheaus/react-ui';
import { useMXDBSync } from '../../src/client';
import { useAction, useUser } from '@anupheaus/socket-api/client';
import { signInAction } from '../common';

export const ClientId = createComponent('ClientId', () => {
  const { clientId } = useMXDBSync();
  const { user, signOut } = useUser();
  const { signIn } = useAction(signInAction);

  const invokeSignIn = useBound(async () => {
    await signIn({ email: 'test@test.com', password: 'test' });
  });

  return <Flex isVertical disableGrow>
    <Flex disableGrow>Client ID:&nbsp;{clientId}</Flex>
    <Flex disableGrow valign="center">User ID:&nbsp;{user?.id}&nbsp;{user == null ? <Button onClick={invokeSignIn}>Sign In</Button> : <Button onClick={signOut}>Sign Out</Button>}</Flex>
  </Flex>;
});