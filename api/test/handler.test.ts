import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { groupsFromClaim, handler } from '../src/handler.js';

const call = async (groups: unknown) =>
  (await handler({
    routeKey: 'GET /nothing',
    requestContext: { authorizer: { jwt: { claims: { sub: 'u', 'cognito:groups': groups } } } },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer)) as APIGatewayProxyStructuredResultV2;

test('JWT の cognito:groups はさまざまな形で届く', () => {
  assert.deepEqual(groupsFromClaim(['admin']), ['admin']);
  assert.deepEqual(groupsFromClaim('[admin app-smart-home]'), ['admin', 'app-smart-home']);
  assert.deepEqual(groupsFromClaim('["app-smart-home","x"]'), ['app-smart-home', 'x']);
  assert.deepEqual(groupsFromClaim(undefined), []);
});

test('W-SSO のアカウントのうち、admin か app-smart-home の人だけ使える', async () => {
  assert.equal((await call(undefined)).statusCode, 403);
  assert.equal((await call('[app-kakeibo]')).statusCode, 403);
  assert.equal((await call('[app-smart-home]')).statusCode, 404); // 権限はある (ルートが無いだけ)
  assert.equal((await call(['admin'])).statusCode, 404);
});
