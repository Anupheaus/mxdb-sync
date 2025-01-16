// import type { AnyFunction } from '@anupheaus/common';
// import { InternalError } from '@anupheaus/common';
// import { UserData } from './UserData';


// export function useUserData() {
//   const scopedUserData = UserData.getStore();

//   function isDataAvailable(): boolean {
//     const userData = UserData.getStore();
//     return userData != null;
//   }

//   function getData<T>(key: string, defaultValue: () => T): T;
//   function getData<T>(key: string): T | undefined;
//   function getData<T>(key: string, defaultValue?: () => T): T | undefined {
//     const userData = UserData.getStore();
//     if (userData == null) throw new Error('UserData is not available at this location.');
//     if (!userData.has(key)) {
//       if (defaultValue == null) return undefined;
//       userData.set(key, defaultValue());
//     }
//     return userData.get(key);
//   }

//   function setData<T>(key: string, value: T) {
//     const userData = UserData.getStore();
//     if (userData == null) throw new Error('UserData is not available at this location.');
//     userData.set(key, value);
//   }

//   function provideUserData<T extends AnyFunction>(handler: T) {
//     if (scopedUserData == null) throw new InternalError('UserData is not available at this location.');
//     return (...args: Parameters<T>): ReturnType<T> => UserData.run(scopedUserData, () => handler(...args));
//   }

//   return {
//     isDataAvailable,
//     getData,
//     setData,
//     provideUserData,
//   };
// }