/**
 * Verified owner identity for Cloudflare Access.
 *
 * Incoming identity headers are ALWAYS stripped (a client can forge them on any
 * path that Access does not guard). They are re-added only after the Access JWT
 * (cookie CF_Authorization or Cf-Access-Jwt-Assertion header) has been verified
 * against the team's signing keys and this application's AUD tag.
 */

type Jwk = JsonWebKey & { kid?: string };
type IdentityEnv = { ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string };

const IDENTITY_HEADERS = [
  'cf-access-authenticated-user-email',
  'oai-authenticated-user-email',
  'oai-authenticated-user-full-name',
  'oai-authenticated-user-full-name-encoding',
];

let certCache: { team: string; keys: Jwk[]; at: number } | null = null;

function b64urlToBytes(value: string): Uint8Array {
  const pad = '='.repeat((4 - (value.length % 4)) % 4);
  const bin = atob(value.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

async function signingKeys(team: string): Promise<Jwk[]> {
  if (certCache && certCache.team === team && Date.now() - certCache.at < 3_600_000) return certCache.keys;
  const response = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error('access certs unavailable');
  const body = (await response.json()) as { keys?: Jwk[] };
  certCache = { team, keys: body.keys || [], at: Date.now() };
  return certCache.keys;
}

export async function verifiedOwnerEmail(request: Request, env: IdentityEnv): Promise<string | null> {
  const team = (env.ACCESS_TEAM_DOMAIN || '').trim();
  const aud = (env.ACCESS_AUD || '').trim();
  if (!team || !aud) return null;
  const token = request.headers.get('cf-access-jwt-assertion') || readCookie(request.headers.get('cookie'), 'CF_Authorization');
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    if (header.alg !== 'RS256') return null;
    const jwk = (await signingKeys(team)).find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      b64urlToBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!valid) return null;
    const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
    const now = Math.floor(Date.now() / 1000);
    const audiences: string[] = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== `https://${team}` || !audiences.includes(aud)) return null;
    if (typeof claims.exp !== 'number' || claims.exp <= now) return null;
    if (typeof claims.nbf === 'number' && claims.nbf > now + 60) return null;
    return typeof claims.email === 'string' && claims.email ? claims.email.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

export async function withVerifiedIdentity(request: Request, env: IdentityEnv): Promise<Request> {
  const headers = new Headers(request.headers);
  for (const name of IDENTITY_HEADERS) headers.delete(name);
  const email = await verifiedOwnerEmail(request, env);
  if (email) {
    headers.set('cf-access-authenticated-user-email', email);
    headers.set('oai-authenticated-user-email', email);
  }
  return new Request(request, { headers });
}
