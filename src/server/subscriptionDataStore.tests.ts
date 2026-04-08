import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearSubscriptionDataKeys,
  subscriptionDataGet,
  subscriptionDataIsAvailable,
  subscriptionDataSet,
} from './subscriptionDataStore';

describe('subscriptionDataStore', () => {
  beforeEach(() => {
    for (const id of ['sub-a', 'sub-b', 'sub-x', 's1'] as const) {
      clearSubscriptionDataKeys(id);
    }
  });

  it('reports data store as available', () => {
    expect(subscriptionDataIsAvailable()).toBe(true);
  });

  it('round-trips values by key', () => {
    subscriptionDataSet('subscription-data.sub-x', 42);
    expect(subscriptionDataGet<number>('subscription-data.sub-x')).toBe(42);
  });

  it('clearSubscriptionDataKeys removes both standard keys for an id', () => {
    subscriptionDataSet('subscription-data.s1', 'prev');
    subscriptionDataSet('subscription-data.additional.s1', ['a', 'b']);
    clearSubscriptionDataKeys('s1');
    expect(subscriptionDataGet('subscription-data.s1')).toBeUndefined();
    expect(subscriptionDataGet('subscription-data.additional.s1')).toBeUndefined();
  });
});
