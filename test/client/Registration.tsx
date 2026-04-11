import { Button, createComponent, Flex, useBound } from '@anupheaus/react-ui';
import { useMXDBInvite } from '../../src/client';
import { useState } from 'react';
import { Error } from '@anupheaus/common';

export const Registration = createComponent('Registration', () => {
  const [error, setError] = useState<Error | undefined>(undefined);
  const invite = useMXDBInvite();

  const register = useBound(async () => {
    const res = await fetch('/api/create-invite');
    const { url } = await res.json() as { url: string; };
    try {
      await invite(url, { displayName: 'MXDB Sync Test' });
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
