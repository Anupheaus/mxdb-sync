/** In-memory store for mxdb subscription handler state (previous response + additional data). */

const store = new Map<string, unknown>();

export function subscriptionDataSet(key: string, value: unknown): void {
  store.set(key, value);
}

export function subscriptionDataGet<T>(key: string): T | undefined {
  return store.get(key) as T | undefined;
}

export function subscriptionDataIsAvailable(): boolean {
  return true;
}

/** Removes keys for one subscription instance; call from the socket unsubscribe path. */
export function clearSubscriptionDataKeys(subscriptionId: string): void {
  store.delete(`subscription-data.${subscriptionId}`);
  store.delete(`subscription-data.additional.${subscriptionId}`);
}
