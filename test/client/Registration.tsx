import { Button, createComponent, Flex, useBound } from '@anupheaus/react-ui';
import { useAuthentication } from '../../src/client';
import { useState } from 'react';
import { Error } from '@anupheaus/common';

export const Registration = createComponent('Registration', () => {
  const [error, setError] = useState<Error | undefined>(undefined);
  const { signIn } = useAuthentication();

  const register = useBound(async () => {
    const res = await fetch('/api/create-invite');
    const { url } = await res.json() as { url: string; };
    // Navigate to the invite URL so ?requestId is in the query string,
    // then trigger WebAuthn registration via signIn().
    window.history.replaceState(null, '', url);
    try {
      await signIn();
    } catch (innerError) {
      setError(new Error({ error: innerError }));
    }
  });

  return (
    <Flex isVertical disableGrow gap="fields">
      <Flex disableGrow>This device is not registered. Click below to register.</Flex>
      <Button onClick={register}>Register This Device</Button>
      {error != null && <Flex disableGrow>Error: {error.message}</Flex>}
    </Flex>
  );
});
