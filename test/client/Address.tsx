import { createComponent } from '@anupheaus/react-ui';
import { useCollection } from '../../src/client';
import { addresses } from '../common';

interface Props {
  id: string;
}

export const Address = createComponent('Address', ({
  id,
}: Props) => {
  const { useGet } = useCollection(addresses);
  const { record: address } = useGet(id);

  return (<>
    <div>{address?.firstLine}</div>
    <div>{address?.secondLine}</div>
    <div>{address?.city}</div>
    <div>{address?.county}</div>
    <div>{address?.postcode}</div>
  </>);
});