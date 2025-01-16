// import type { Socket } from 'socket.io';
// import { UserData } from './UserData';

// const allUserData = new WeakMap<Socket, Map<string, any>>();

// export function provideUserData<T>(client: Socket, fn: () => T): T {
//   const userData = allUserData.set(client, allUserData.get(client) ?? new Map()).get(client)!;
//   return UserData.run(userData, fn);
// }
