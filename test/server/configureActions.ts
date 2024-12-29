import { createServerAction, type MXDBServerAction } from '../../src/server';
import { testEndpoint } from '../common';

export const actions: MXDBServerAction[] = [
  createServerAction(testEndpoint, async ({ foo }) => {
    return { bar: foo };
  }),
];
