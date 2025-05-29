// import { type Socket } from '@anupheaus/socket-api/server';
// import { MXDBClient } from './MXDBClient';

// const clients = new WeakMap<Socket, MXDBClient>();

// export function registerClient(client: Socket) {
//   clients.set(client, new MXDBClient());
// }

// export function terminateClient(client: Socket) {
//   const mxdbClient = clients.get(client);
//   if (mxdbClient == null) return;
//   mxdbClient.terminate();
//   clients.delete(client);
// }

// // export function getClient(client: Socket) {
// //   return clients.get(client);
// // }

// // export function useClient() {
// //   const { getClient: getSocketAPIClient } = useSocketAPI();
// //   const client = getSocketAPIClient(false);
// //   return client != null ? clients.get(client) : undefined;
// // }


