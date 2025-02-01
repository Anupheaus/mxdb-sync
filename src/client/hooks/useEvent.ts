// import type { MXDBEvent } from '../../common';
// import { useSocket } from '../providers';
// import { useRef } from 'react';

// export type GetUseEventType<EventType extends MXDBEvent<any>> = EventType extends MXDBEvent<infer T> ? ReturnType<typeof useEvent<T>> : never;

// export function useEvent<T>(event: MXDBEvent<T>) {
//   const { on } = useSocket();
//   const handlerRef = useRef<(payload: T) => void>(() => void 0);

//   on<T>(`mxdb.events.${event.name}`, payload => handlerRef.current(payload));

//   return (handler: (payload: T) => void) => { handlerRef.current = handler; };
// }