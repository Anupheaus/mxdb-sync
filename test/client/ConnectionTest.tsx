import { useState } from 'react';
import { useSocket } from '../../src/client/providers/socket/useSocket';
import { Button, createComponent, createStyles, Flex } from '@anupheaus/react-ui';

const useStyles = createStyles({
  connectionStatus: {
    borderRadius: 8,
    '&.socket-connected': {
      backgroundColor: 'green',
    },
    '&.socket-disconnected': {
      backgroundColor: 'red',
    },
  },
});

export const ConnectionTest = createComponent('ConnectionTest', () => {
  const { css, join } = useStyles();
  const { onConnectionStateChange, fakeDisconnect, fakeReconnect } = useSocket();
  const [isConnected, setIsConnected] = useState(false);
  onConnectionStateChange(newIsConnected => setIsConnected(newIsConnected));

  return (
    <Flex gap={'fields'} disableGrow>
      <Flex className={join(css.connectionStatus, isConnected ? 'socket-connected' : 'socket-disconnected')} />
      <Button onClick={fakeDisconnect}>Disconnect</Button>
      <Button onClick={fakeReconnect}>Reconnect</Button>
    </Flex>
  );
});