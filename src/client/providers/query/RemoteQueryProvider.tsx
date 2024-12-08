import { createComponent, useMap } from '@anupheaus/react-ui';
import { type ReactNode, useMemo } from 'react';
import { type RemoteQueryContextProps, RemoteQueryContext } from './RemoteQueryContext';
import { QueryUpdateHandler } from './RemoteQueryHandler';
import { useSocket } from '../socket';

interface Props {
  children?: ReactNode;
}

export const RemoteQueryProvider = createComponent('RemoteQueryProvider', ({
  children = null,
}: Props) => {
  const { emit, on } = useSocket();
  const queryUpdateHandlers = useMap<string, QueryUpdateHandler>();
  const hookedHandlers = useMap<string, string>();

  const context = useMemo<RemoteQueryContextProps>(() => ({
    isValid: true,
    async registerQuery(props) {
      const { hookId, collection, dbName, onUpdate } = props;
      const hash = Object.hash({ collection, dbName, props });
      const existingHash = hookedHandlers.get(hookId);
      if (existingHash != null && existingHash !== hash) {
        const currentHandler = queryUpdateHandlers.get(existingHash);
        if (currentHandler) currentHandler.unregisterHook(hookId);
      }
      const handler = queryUpdateHandlers.getOrSet(hash, () => new QueryUpdateHandler({ ...props, emit, on }));
      await handler.registerOrUpdateHook({ hookId, onUpdate });
      hookedHandlers.set(hookId, hash);
    },
    async unregisterQuery(hookId) {
      const hash = hookedHandlers.get(hookId);
      if (hash == null) return;
      const handler = queryUpdateHandlers.get(hash);
      if (handler != null) {
        handler.unregisterHook(hookId);
        if (handler.length === 0) queryUpdateHandlers.delete(hash);
      }
      hookedHandlers.delete(hookId);
    },
  }), []);

  return (
    <RemoteQueryContext.Provider value={context}>
      {children}
    </RemoteQueryContext.Provider>
  );
});
