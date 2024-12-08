import type { AnyObject } from '@anupheaus/common';
import { to } from '@anupheaus/common';

export function reconstruct(data: AnyObject) {
  try {
    return to.deserialise(data);
  } catch (e) {
    return data;
  }
}
