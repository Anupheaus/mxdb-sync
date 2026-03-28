import { Logger } from '@anupheaus/common';
import { useSocketAPI } from '@anupheaus/socket-api/server';
import {
  subscriptionDataGet,
  subscriptionDataIsAvailable,
  subscriptionDataSet,
} from '../subscriptionDataStore';

export function useClient() {
  const result = useSocketAPI();

  function getLogger(subLoggerName?: string) {
    const parentLogger = Logger.getCurrent() ?? new Logger('mxdb-sync');
    const client = result.getClient();
    const clientLogger = parentLogger.createSubLogger(client?.id ?? 'admin');
    if (subLoggerName != null) return clientLogger.createSubLogger(subLoggerName);
    return clientLogger;
  }

  const additions = {
    getLogger,
    isDataAvailable: subscriptionDataIsAvailable,
    getData: subscriptionDataGet,
    setData: subscriptionDataSet,
  };

  return Object.assign(result, additions);
}
