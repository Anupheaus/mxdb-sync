import Koa from 'koa';
import { ApiError, Logger } from '@anupheaus/common';

export function createRequestLogger(logger: Logger): Koa.Middleware {
  return async (ctx, next) => {
    try {
      // logger.info('Request started', { method: ctx.method, path: ctx.path });
      ctx.body = ctx.request.body;
      await next();
      logger.info('Request handled', { method: ctx.method, path: ctx.path, status: ctx.status });
    } catch (error) {
      if (error instanceof ApiError) {
        ctx.status = error.statusCode ?? 500;
        ctx.body = error.message;
      } else {
        ctx.status = 500;
        ctx.body = 'Internal server error';
      }
      logger.error('Error handling request', { method: ctx.method, path: ctx.path, status: ctx.status, message: ctx.body });
    }
  };
}