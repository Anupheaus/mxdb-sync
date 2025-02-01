// import { createComponent, useBound } from '@anupheaus/react-ui';
// import { useLayoutEffect, useMemo, type ReactNode } from 'react';
// import type { UserContextType } from './UserContext';
// import { UserContext } from './UserContext';
// import type { UnauthorisedOperationDetails } from '../../../common';
// import { mxdbAuthenticateTokenAction } from '../../../common';
// import { useAction } from '../../hooks';

// interface Props {
//   token: string | undefined;
//   onInvalidToken?(): Promise<void>;
//   onUnauthorisedOperation?(): Promise<UnauthorisedOperationDetails>;
//   children: ReactNode;
// }

// export const AuthenticationProvider = createComponent('AuthenticationProvider', ({
//   token,
//   onInvalidToken,
//   onUnauthorisedOperation,
//   children
// }: Props) => {
//   const { isConnected, mxdbAuthenticateTokenAction: authenticateToken } = useAction(mxdbAuthenticateTokenAction);
//   const [];
//   const getUserId = useBound(() => undefined);
//   const getToken = useBound(() => token);

//   useLayoutEffect(() => {
//     if (isConnected() && token != null) {
//       authenticateToken(token);
//     }
//   }, []);

//   const context = useMemo<UserContextType>(() => ({ getUserId, getToken }), []);

//   return (
//     <UserContext.Provider value={context}>
//       {children}
//     </UserContext.Provider>
//   );
// });
