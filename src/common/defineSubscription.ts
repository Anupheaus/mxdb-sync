export interface MXDBSubscription<Name extends string, Request, Response> { name: Name, requestType?: Request; responseType?: Response; }

export function defineSubscription<Request, Response>() {
  return <Name extends string>(name: Name): MXDBSubscription<Name, Request, Response> => ({
    name,
  });
}
