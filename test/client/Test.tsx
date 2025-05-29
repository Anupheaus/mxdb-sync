import { Button, createComponent, createStyles, Flex, Skeleton, Tag } from '@anupheaus/react-ui';
import type { ReactNode } from 'react';

const useStyles = createStyles({
  testResult: {
    display: 'block',
    width: 30,
    height: 30,
    borderRadius: 5,
    backgroundColor: 'yellow',

    '&.test-success': {
      backgroundColor: 'green',
    },

    '&.test-error': {
      backgroundColor: 'red',
    },
  },

  testButton: {
    flexGrow: 1,
  },
});

interface Props {
  isBusy: boolean;
  result: boolean | undefined;
  onTest(): Promise<void>;
  children: ReactNode;
}

export const Test = createComponent('Test', ({
  isBusy,
  result,
  children,
  onTest,
}: Props) => {
  const { css, join } = useStyles();

  return (
    <Flex tagName="test" gap="fields" disableGrow valign="center">
      <Button onClick={onTest} className={css.testButton}>{children}</Button>
      <Flex tagName="test-result" disableGrow>
        <Tag name="test-result" className={join(css.testResult, result === true ? 'test-success' : (result === false && 'test-error'))} />
        <Skeleton type="full" isVisible={isBusy} />
      </Flex>
    </Flex>
  );
});