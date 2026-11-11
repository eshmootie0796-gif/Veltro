import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ValidationError } from "../../errors";

const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal"]);

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function isPrivateIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  const ranges: Array<[number, number]> = [
    [ipv4ToInt("0.0.0.0"), ipv4ToInt("0.255.255.255")],
    [ipv4ToInt("10.0.0.0"), ipv4ToInt("10.255.255.255")],
    [ipv4ToInt("127.0.0.0"), ipv4ToInt("127.255.255.255")],
    [ipv4ToInt("169.254.0.0"), ipv4ToInt("169.254.255.255")],
    [ipv4ToInt("172.16.0.0"), ipv4ToInt("172.31.255.255")],
    [ipv4ToInt("192.168.0.0"), ipv4ToInt("192.168.255.255")],
    [ipv4ToInt("100.64.0.0"), ipv4ToInt("100.127.255.255")],
  ];
  return ranges.some(([a, b]) => n >= a && n <= b);
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — evaluate embedded IPv4.
  const mapped = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped?.[1]) return isPrivateIpv4(mapped[1]);
  const mappedHex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (mappedHex?.[1] && mappedHex?.[2]) {
    const hi = Number.parseInt(mappedHex[1], 16);
    const lo = Number.parseInt(mappedHex[2], 16);
    const dotted = `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
    return isPrivateIpv4(dotted);
  }
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80")
  );
}

export function assertSafeHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError("Invalid product URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ValidationError("Only HTTP and HTTPS URLs are allowed");
  }
  if (url.username || url.password) {
    throw new ValidationError("URLs with credentials are not allowed");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new ValidationError("URL host is not allowed");
  }
  const ipVersion = isIP(host);
  if (ipVersion === 4 && isPrivateIpv4(host)) {
    throw new ValidationError("Private IP addresses are not allowed");
  }
  if (ipVersion === 6 && isPrivateIpv6(host)) {
    throw new ValidationError("Private IP addresses are not allowed");
  }
  return url;
}

export async function assertResolvedHostPublic(hostname: string): Promise<void> {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    assertSafeHttpUrl(`https://${host}/`);
    return;
  }
  let records: string[] = [];
  try {
    const result = await lookup(host, { all: true, verbatim: true });
    records = result.map((r) => r.address);
  } catch {
    throw new ValidationError("Unable to resolve product URL host");
  }
  if (records.length === 0) throw new ValidationError("Unable to resolve product URL host");
  for (const address of records) {
    if (isIP(address) === 4 && isPrivateIpv4(address)) {
      throw new ValidationError("URL resolves to a private network");
    }
    if (isIP(address) === 6 && isPrivateIpv6(address)) {
      throw new ValidationError("URL resolves to a private network");
    }
  }
}
