import Koa from 'koa';
import { AnyHttpServer } from '../../internalModels';

export interface KoaContextProps {
  app: Koa;
  server: AnyHttpServer;
}
