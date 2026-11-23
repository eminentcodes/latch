import { createHmac, timingSafeEqual } from 'node:crypto';
import { validCheckoutRoot } from './checkout.js';

export const SESSION_MS = 45 * 60 * 1000;
export const SESSION_COOKIE = 'latch_demo_session';
export const SANDBOX_PORTS = {original: 4317, workspace: 4318, repaired: 4319} as const;
export const REPOSITORY_URL = 'https://github.com/eminentcodes/latch.git';

export type SessionTicket = {name: string; sourceRef: string; expiresAt: number; checkoutRoot?: string};
export type HostingConfig = {
  enabled: boolean; sessionSecret: string; sourceRef: string; kaneEnabled: boolean;
  kaneUsername: string; kaneAccessKey: string; homeUrl: string;
};

export function hostingConfig(env: NodeJS.ProcessEnv, sourceRef: string, homeUrl: string): HostingConfig {
  const sessionSecret = env.LATCH_SESSION_SECRET ?? '';
  const enabled = env.LATCH_DEMO_ENABLED === 'true' && sessionSecret.length >= 32 && sessionSecret.length <= 256
    && /^[a-f0-9]{40}$/.test(sourceRef);
  return {enabled, sessionSecret, sourceRef, homeUrl,
    kaneEnabled: env.LATCH_KANE_ENABLED === 'true' && Boolean(env.LT_USERNAME && env.LT_ACCESS_KEY),
    kaneUsername: env.LT_USERNAME ?? '', kaneAccessKey: env.LT_ACCESS_KEY ?? ''};
}

function signature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function signTicket(ticket: SessionTicket, secret: string): string {
  const payload = Buffer.from(JSON.stringify(ticket)).toString('base64url');
  return payload + '.' + signature(payload, secret);
}

export function readTicket(value: string | undefined, secret: string, sourceRef: string, now = Date.now()): SessionTicket | null {
  if (!value || value.length > 2048 || secret.length < 32) return null;
  const parts = value.split('.');
  if (parts.length !== 2) return null;
  const [payload, mac] = parts as [string, string];
  const supplied = Buffer.from(mac);
  const expected = Buffer.from(signature(payload, secret));
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const ticket = JSON.parse(Buffer.from(payload, 'base64url').toString()) as SessionTicket;
    if (!ticket || typeof ticket.name !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(ticket.name)
      || ticket.sourceRef !== sourceRef || !Number.isSafeInteger(ticket.expiresAt)
      || (ticket.checkoutRoot !== undefined && !validCheckoutRoot(ticket.checkoutRoot))
      || ticket.expiresAt <= now || ticket.expiresAt > now + SESSION_MS) return null;
    return ticket;
  } catch {return null;}
}

export function cookieValue(header: string | undefined): string | undefined {
  return header?.split(';').map(part => part.trim()).find(part => part.startsWith(SESSION_COOKIE + '='))?.slice(SESSION_COOKIE.length + 1);
}

export function sameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.host === host;
  } catch {return false;}
}
