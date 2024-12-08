import { Context } from '../../contexts';
import { KoaContextProps } from './koaContexts';

export function useKoa() {
  return Context.get<KoaContextProps>('koa');
}