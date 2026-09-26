import { SLUG_PATTERN } from '@osd/shared';

export type HostMatch = { kind: 'site'; slug: string } | { kind: 'root' } | { kind: 'invalid' };

/**
 * {slug}.{rootDomain} → site; the root domain itself (or anything not under it, e.g. an IP used by
 * a load balancer health check) → root, where the internal endpoints live.
 */
export function matchHost(hostHeader: string | undefined, rootDomain: string): HostMatch {
  if (!hostHeader) return { kind: 'root' };
  const host = hostHeader.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  const root = rootDomain.toLowerCase().replace(/:\d+$/, '');
  if (host === root) return { kind: 'root' };
  const suffix = `.${root}`;
  if (!host.endsWith(suffix)) return { kind: 'root' };
  const label = host.slice(0, -suffix.length);
  // Exactly one label: a.b.example.com is not a valid site host.
  if (label.includes('.') || label.length < 3 || label.length > 40 || !SLUG_PATTERN.test(label)) {
    return { kind: 'invalid' };
  }
  return { kind: 'site', slug: label };
}
