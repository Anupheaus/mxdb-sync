import type { AnyObject } from '@anupheaus/common';

export type AddDisableTo<Target extends AnyObject> = Target & { disable?: boolean };
export type AddDebugTo<Target extends AnyObject> = Target & { debug?: boolean };
