export interface MXDBEvent<T> {
  name: string;
  argsType?: T;
}

export function defineEvent<T>(name: string): MXDBEvent<T> {
  return {
    name,
  };
}
