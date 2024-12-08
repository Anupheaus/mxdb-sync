import { createComponent } from '@anupheaus/react-ui';
import { MXDBSync } from '../../src/client';
import { collections } from '../common';
import { Addresses } from './Addresses';

export const App = createComponent('App', () => {
  return (
    <MXDBSync name="test" collections={collections}>
      <Addresses />
    </MXDBSync>
  );
});
