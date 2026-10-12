import { pathToFileURL } from 'node:url';

import dotenv from 'dotenv';

export type SalesforceToken = {
  access_token: string;
  instance_url?: string;
  token_type?: string;
  expires_in?: number;
};

export type TokenEnv = {
  SF_MY_DOMAIN?: string;
  SF_CLIENT_ID?: string;
  SF_CLIENT_SECRET?: string;
};

type Cache = {
  token: SalesforceToken | null;
  expiresAt: number;
};

const defaultCache: Cache = { token: null, expiresAt: 0 };

const FALLBACK_TTL_SEC = 15 * 60;
const REFRESH_SKEW_MS = 60_000;

function expiresInSeconds(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return FALLBACK_TTL_SEC;
}

export async function getToken(options?: {
  fetchImpl?: typeof fetch;
  env?: TokenEnv;
  cache?: Cache;
  now?: number;
}): Promise<SalesforceToken> {
  const env = options?.env ?? process.env;
  const cache = options?.cache ?? defaultCache;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const now = options?.now ?? Date.now();

  if (cache.token && cache.expiresAt - REFRESH_SKEW_MS > now) {
    return cache.token;
  }

  const domain = env.SF_MY_DOMAIN?.replace(/\/$/, '');
  const clientId = env.SF_CLIENT_ID;
  const clientSecret = env.SF_CLIENT_SECRET;
  if (!domain || !clientId || !clientSecret) {
    throw new Error('Missing SF_MY_DOMAIN, SF_CLIENT_ID, or SF_CLIENT_SECRET');
  }

  let response: Response;
  try {
    response = await fetchImpl(`${domain}/services/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'request failed';
    throw new Error(`Salesforce token request failed: ${message}`);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Salesforce token request failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as Partial<SalesforceToken>;
  if (typeof data.access_token !== 'string' || data.access_token === '') {
    throw new Error('Salesforce token response did not include access_token');
  }

  const token: SalesforceToken = {
    access_token: data.access_token,
    instance_url: typeof data.instance_url === 'string' ? data.instance_url : undefined,
    token_type: typeof data.token_type === 'string' ? data.token_type : undefined,
    expires_in: expiresInSeconds(data.expires_in),
  };

  cache.token = token;
  cache.expiresAt = now + token.expires_in * 1000;
  return token;
}

export function invalidate(cache: Cache = defaultCache): void {
  cache.token = null;
  cache.expiresAt = 0;
}

const isMain =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  dotenv.config();
  getToken()
    .then((token) => {
      const instance = token.instance_url ?? '(missing instance_url)';
      console.log(`Salesforce token ok. instance_url=${instance}`);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Salesforce token request failed';
      console.error(message);
      process.exitCode = 1;
    });
}
