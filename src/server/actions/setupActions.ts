import { useSocket } from '../providers';
import type { MXDBServerAction } from './createServerAction';

export function setupActions(actions: MXDBServerAction[]) {
  if (actions.length === 0) return;
  const { onClientConnected } = useSocket();

  onClientConnected(({ logger }) => {
    logger.debug('Setting up actions...');
    actions.forEach(action => action());
    logger.debug('Actions set up.');
  });
}