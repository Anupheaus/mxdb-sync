import { ClientAsyncStore } from './provideClient';

export function useClient() {
  const props = ClientAsyncStore.getStore();
  if (props == null) throw new Error('useClient must be called within a connected client context.');
  return props;
}
