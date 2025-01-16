import { Context } from '../../contexts';
import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import { createRequestLogger } from '../logger';
import type { AnyHttpServer } from '../../internalModels';
import type { KoaContextProps } from './koaContexts';

export function setupKoa(server: AnyHttpServer) {
  const app = new Koa();
  app.use(bodyParser());
  app.use(createRequestLogger());

  Context.set<KoaContextProps>('koa', { app, server });

  server.on('request', app.callback());

  return app;
}