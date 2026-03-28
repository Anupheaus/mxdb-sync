import Router from 'koa-router';
import type Koa from 'koa';

const TEST_USER_ID = 'test-user-1';

export function configureAuth(
  app: Koa,
  createInviteLink: (userId: string, domain: string) => Promise<string>,
): void {
  const router = new Router();

  router.get('/api/create-invite', async ctx => {
    // Use http:// URL so the client's extractRequestId can parse the requestId
    // from the query param regardless of protocol.
    const url = await createInviteLink(TEST_USER_ID, ctx.host);
    ctx.body = { url };
  });

  app.use(router.routes());
  app.use(router.allowedMethods());
}
