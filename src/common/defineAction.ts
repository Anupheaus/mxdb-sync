export interface MXDBAction<Name extends string, Request, Response> { name: Name, requestType?: Request; responseType?: Response; }

export function defineAction<Request, Response>() {
  return <Name extends string>(name: Name): MXDBAction<Name, Request, Response> => ({
    name,
  });
}
