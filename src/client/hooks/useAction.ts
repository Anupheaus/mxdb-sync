// import { useLayoutEffect, useRef, useState } from 'react';
// import type { MXDBAction } from '../../common';
// import { useSocket } from '../providers';
// import { Error } from '@anupheaus/common';

// function a<Request, Response>(request: Request, response: (response: Response) => void): void;
// function a<Request, Response>(request: Request): Promise<Response>;
// function a<Request, Response>(_request: Request, _response?: (response: Response) => void): void | Promise<Response> {
//   return;
// }

// export type UseAction<Name extends string, Request, Response> = {
//   isConnected(): boolean;
// } & {
//   [P in Name]: typeof a<Request, Response>;
// } & {
//   [P in `use${Capitalize<Name>}`]: (request: Request) => { response: Response | undefined; error: Error | undefined; isLoading: boolean; };
// };

// export type GetUseActionType<ActionType extends MXDBAction<any, any, any>> = ActionType extends MXDBAction<infer Name, infer Request, infer Response> ? UseAction<Name, Request, Response>[Name] : never;

// export function useAction<Name extends string, Request, Response>(action: MXDBAction<Name, Request, Response>): UseAction<Name, Request, Response> {
//   const { isConnected, emit } = useSocket();
//   return {
//     [action.name]: async (request: Request, response?: (response: Response) => void) => {
//       if (typeof (response) === 'function') {
//         emit<Response, Request>(`mxdb.actions.${action.name.toString()}`, request).then(res => response(res));
//       } else {
//         return emit<Response, Request>(`mxdb.actions.${action.name.toString()}`, request);
//       }
//     },
//     [`use${action.name.toString()}`]: (request: Request) => {
//       const [state, setState] = useState<{ response: Response | undefined; error: Error | undefined; isLoading: boolean; }>({ response: undefined, error: undefined, isLoading: true });
//       const isMonitoringErrorRef = useRef(false);

//       useLayoutEffect(() => {
//         setState({ response: undefined, error: undefined, isLoading: true });
//         (async () => {
//           try {
//             const response = await emit<Response, Request>(`mxdb.actions.${action.name.toString()}`, request);
//             setState({ response, error: undefined, isLoading: false });
//           } catch (error) {
//             if (isMonitoringErrorRef.current) {
//               setState({ response: undefined, error: new Error({ error }), isLoading: false });
//             } else {
//               throw error;
//             }
//           }
//         })();
//       }, []);

//       return {
//         ...state,
//         get error() {
//           isMonitoringErrorRef.current = true;
//           return state.error;
//         },
//       };
//     },
//     isConnected,
//   } as UseAction<Name, Request, Response>;
// }