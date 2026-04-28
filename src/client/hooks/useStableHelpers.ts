import type { AnyObject } from '@anupheaus/common';
import { useMemo, useRef } from 'react';

export function useStableHelpers<HelperResults extends AnyObject>(rawHelpers: HelperResults | undefined): HelperResults | undefined {
  const latestRef = useRef(rawHelpers);
  latestRef.current = rawHelpers;

  const keysSignature = rawHelpers == null ? '' : Object.keys(rawHelpers).sort().join(',');
  const stableFunctionWrappers = useMemo(() => {
    if (rawHelpers == null) return {};
    const wrappers: AnyObject = {};
    for (const key of Object.keys(rawHelpers)) {
      if (typeof (rawHelpers as AnyObject)[key] === 'function') {
        wrappers[key] = (...args: unknown[]) => (latestRef.current as AnyObject)[key](...args);
      }
    }
    return wrappers;
  }, [keysSignature]);

  if (rawHelpers == null) return undefined;
  return { ...rawHelpers, ...stableFunctionWrappers } as HelperResults;
}
