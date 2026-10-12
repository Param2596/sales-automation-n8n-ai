import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { describe, it } from 'node:test';

import { getToken, invalidate, type TokenEnv } from '../scripts/salesforce/auth.mts';

const env: TokenEnv = {
  SF_MY_DOMAIN: '',
  SF_CLIENT_ID: 'test-client-id',
  SF_CLIENT_SECRET: 'test-client-secret',
};

type Hit = { method: string | undefined; url: string | undefined; type: string; body: string };

async function withMock(
  handler: (req: IncomingMessage, res: ServerResponse, hits: Hit[]) => void,
  run: (baseUrl: string, hits: Hit[]) => Promise<void>,
): Promise<void> {
  const hits: Hit[] = [];
  const server = createServer((req, res) => handler(req, res, hits));
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    throw new Error('mock server has no port');
  }
  try {
    await run(`http://127.0.0.1:${address.port}`, hits);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

describe('getToken', () => {
  it('posts client credentials to the token endpoint and caches the result', async () => {
    await withMock(
      async (req, res, hits) => {
        const body = await readBody(req);
        hits.push({
          method: req.method,
          url: req.url,
          type: req.headers['content-type'] ?? '',
          body,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            access_token: 'mock-access-token',
            instance_url: 'https://your-org.my.salesforce.com',
            token_type: 'Bearer',
            expires_in: 600,
          }),
        );
      },
      async (baseUrl, hits) => {
        const cache = { token: null, expiresAt: 0 };
        const first = await getToken({
          env: { ...env, SF_MY_DOMAIN: baseUrl },
          cache,
          now: 1_000,
        });
        const second = await getToken({
          env: { ...env, SF_MY_DOMAIN: `${baseUrl}/` },
          cache,
          now: 2_000,
        });

        assert.equal(hits.length, 1);
        assert.equal(hits[0].method, 'POST');
        assert.equal(hits[0].url, '/services/oauth2/token');
        assert.match(hits[0].type, /application\/x-www-form-urlencoded/);
        const params = new URLSearchParams(hits[0].body);
        assert.equal(params.get('grant_type'), 'client_credentials');
        assert.equal(params.get('client_id'), 'test-client-id');
        assert.equal(params.get('client_secret'), 'test-client-secret');
        assert.equal(first.access_token, 'mock-access-token');
        assert.equal(second.instance_url, 'https://your-org.my.salesforce.com');
        assert.equal(first, second);
      },
    );
  });

  it('refetches once the cached token is inside the 60 second refresh window', async () => {
    await withMock(
      async (_req, res, hits) => {
        hits.push({ method: 'POST', url: '/services/oauth2/token', type: '', body: '' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ access_token: `mock-access-token-${hits.length}`, expires_in: '120' }));
      },
      async (baseUrl, hits) => {
        const cache = { token: null, expiresAt: 0 };
        const options = { env: { ...env, SF_MY_DOMAIN: baseUrl }, cache };
        await getToken({ ...options, now: 0 });
        await getToken({ ...options, now: 50_000 });
        const refreshed = await getToken({ ...options, now: 70_000 });
        assert.equal(hits.length, 2);
        assert.equal(refreshed.access_token, 'mock-access-token-2');
      },
    );
  });

  it('does not cache a failed token response and omits the client secret from the error', async () => {
    await withMock(
      async (_req, res, hits) => {
        hits.push({ method: 'POST', url: '/services/oauth2/token', type: '', body: '' });
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_client' }));
      },
      async (baseUrl, hits) => {
        const cache = { token: null, expiresAt: 0 };
        await assert.rejects(
          () => getToken({ env: { ...env, SF_MY_DOMAIN: baseUrl }, cache, now: 0 }),
          (error: unknown) => {
            assert.ok(error instanceof Error);
            assert.match(error.message, /401/);
            assert.equal(error.message.includes('test-client-secret'), false);
            return true;
          },
        );
        assert.equal(cache.token, null);
        assert.equal(hits.length, 1);
      },
    );
  });

  it('throws before calling the network when configuration is missing', async () => {
    let called = false;
    const fetchImpl: typeof fetch = async () => {
      called = true;
      throw new Error('network should not be called');
    };
    await assert.rejects(
      () => getToken({ env: { SF_MY_DOMAIN: 'https://your-org.my.salesforce.com' }, fetchImpl }),
      /Missing SF_MY_DOMAIN, SF_CLIENT_ID, or SF_CLIENT_SECRET/,
    );
    assert.equal(called, false);
  });

  it('clears the cache on invalidate', () => {
    const cache = {
      token: { access_token: 'mock-access-token' },
      expiresAt: 10,
    };
    invalidate(cache);
    assert.equal(cache.token, null);
    assert.equal(cache.expiresAt, 0);
  });
});
