import { UserData } from './UserData';


export function useUserData() {

  function isDataAvailable(): boolean {
    const userData = UserData.getStore();
    return userData != null;
  }

  function getData<T>(key: string, defaultValue: () => T): T;
  function getData<T>(key: string): T | undefined;
  function getData<T>(key: string, defaultValue?: () => T): T | undefined {
    const userData = UserData.getStore();
    if (userData == null) throw new Error('UserData is not available at this location.');
    if (!userData.has(key)) {
      if (defaultValue == null) return undefined;
      userData.set(key, defaultValue());
    }
    return userData.get(key);
  }

  function setData<T>(key: string, value: T) {
    const userData = UserData.getStore();
    if (userData == null) throw new Error('UserData is not available at this location.');
    userData.set(key, value);
  }

  return {
    isDataAvailable,
    getData,
    setData,
  };
}