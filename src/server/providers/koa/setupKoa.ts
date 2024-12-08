import { Context } from '../../contexts';
import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import { useLogger } from '../logger';
import { AnyHttpServer } from '../../internalModels';
import { KoaContextProps } from './koaContexts';

export function setupKoa(server: AnyHttpServer) {
  const app = new Koa();
  const { requestLogging } = useLogger();
  app.use(bodyParser());
  app.use(requestLogging);

  Context.set<KoaContextProps>('koa', { app, server });

  server.on('request', app.callback());

  return app;
}