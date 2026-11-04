// IP アドレス制限の純粋ロジック（PRO版仕様書 §4.12）。テスト対象。
//
// - 許可リストは IPv4／IPv6 の単一アドレスまたは CIDR（例: 203.0.113.10, 203.0.113.0/24, 2001:db8::/32）
// - 接続元 IP は逆プロキシ（ALB → nginx → app）が付ける X-Forwarded-For から取る。
//   信頼するプロキシ段数 TRUSTED_PROXY_HOPS（既定 1）だけ右端から数えた位置がクライアント IP。
//   本番（ALB + nginx）は 2。ヘッダが無ければ直接接続（開発環境）とみなし 127.0.0.1 を返す
// - IPv4 射影 IPv6（::ffff:203.0.113.10）は IPv4 として扱う

export const MAX_IP_ALLOW_ENTRIES = 20;

type Parsed = { family: 4 | 6; bits: bigint };

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function parseIpv4(s: string): bigint | null {
  const m = IPV4_RE.exec(s);
  if (!m) return null;
  let v = 0n;
  for (let i = 1; i <= 4; i++) {
    const n = Number(m[i]);
    if (n > 255) return null;
    v = (v << 8n) | BigInt(n);
  }
  return v;
}

function parseIpv6(s: string): bigint | null {
  let str = s.toLowerCase();
  // 末尾が IPv4 表記（::ffff:1.2.3.4）なら 16bit × 2 に展開
  const v4tail = /^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(str);
  if (v4tail) {
    const v4 = parseIpv4(v4tail[2]);
    if (v4 == null) return null;
    str = `${v4tail[1]}${((v4 >> 16n) & 0xffffn).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  if (str.includes(":::") || (str.match(/::/g) ?? []).length > 1) return null;
  const [head, tail] = str.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail != null ? (tail ? tail.split(":") : []) : null;
  const groups = tailParts
    ? [...headParts, ...Array(8 - headParts.length - tailParts.length).fill("0"), ...tailParts]
    : headParts;
  if (groups.length !== 8) return null;
  let v = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    v = (v << 16n) | BigInt(parseInt(g, 16));
  }
  return v;
}

export function parseIp(input: string): Parsed | null {
  const s = input.trim();
  if (!s) return null;
  const v4 = parseIpv4(s);
  if (v4 != null) return { family: 4, bits: v4 };
  if (!s.includes(":")) return null;
  const v6 = parseIpv6(s);
  if (v6 == null) return null;
  // IPv4 射影アドレス（::ffff:a.b.c.d）は IPv4 として扱う
  if (v6 >> 32n === 0xffffn) return { family: 4, bits: v6 & 0xffffffffn };
  return { family: 6, bits: v6 };
}

export type CidrRule = { family: 4 | 6; network: bigint; prefix: number };

// "a.b.c.d" / "a.b.c.d/24" / "2001:db8::/32" を解釈する。不正なら null
export function parseCidr(input: string): CidrRule | null {
  const s = input.trim();
  const slash = s.indexOf("/");
  const addr = slash >= 0 ? s.slice(0, slash) : s;
  const ip = parseIp(addr);
  if (!ip) return null;
  const maxBits = ip.family === 4 ? 32 : 128;
  let prefix = maxBits;
  if (slash >= 0) {
    const p = s.slice(slash + 1);
    if (!/^\d{1,3}$/.test(p)) return null;
    prefix = Number(p);
    if (prefix > maxBits) return null;
  }
  const mask = prefix === 0 ? 0n : ((1n << BigInt(prefix)) - 1n) << BigInt(maxBits - prefix);
  return { family: ip.family, network: ip.bits & mask, prefix };
}

export function ipMatchesRule(ip: string, rule: CidrRule): boolean {
  const parsed = parseIp(ip);
  if (!parsed || parsed.family !== rule.family) return false;
  const maxBits = rule.family === 4 ? 32 : 128;
  const mask = rule.prefix === 0 ? 0n : ((1n << BigInt(rule.prefix)) - 1n) << BigInt(maxBits - rule.prefix);
  return (parsed.bits & mask) === rule.network;
}

// 許可リスト（文字列配列）に接続元 IP が含まれるか。リストが空なら制限なし＝許可
export function isIpAllowed(ip: string | null, allowList: readonly string[]): boolean {
  if (allowList.length === 0) return true;
  if (!ip) return false;
  return allowList.some((entry) => {
    const rule = parseCidr(entry);
    return rule != null && ipMatchesRule(ip, rule);
  });
}

// 許可リストの入力検証。正規化した配列か、エラー文言を返す
export function validateIpAllowList(entries: readonly string[]): { list: string[] } | { error: string } {
  const list: string[] = [];
  for (const raw of entries) {
    const s = raw.trim();
    if (!s) continue;
    if (!parseCidr(s)) return { error: `IP アドレスまたは CIDR の形式が不正です: ${s}` };
    if (!list.includes(s)) list.push(s);
  }
  if (list.length > MAX_IP_ALLOW_ENTRIES) return { error: `許可 IP は${MAX_IP_ALLOW_ENTRIES}件までです` };
  return { list };
}

// 信頼するプロキシ段数（本番 ALB + nginx = 2）。未設定は 1
export function trustedProxyHops(): number {
  const n = Number(process.env.TRUSTED_PROXY_HOPS ?? "1");
  return Number.isInteger(n) && n >= 0 ? n : 1;
}

// ヘッダから接続元 IP を決める。X-Forwarded-For の右端から hops 番目（1 始まり）。
// hops=0 または ヘッダ無しは直接接続とみなす（アプリは 127.0.0.1 にしか bind しない運用）
export function clientIpFromHeaders(getHeader: (name: string) => string | undefined, hops = trustedProxyHops()): string {
  const xff = getHeader("x-forwarded-for");
  if (!xff || hops <= 0) return "127.0.0.1";
  const parts = xff
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return "127.0.0.1";
  const idx = Math.max(0, parts.length - hops);
  const ip = parts[idx];
  // "[2001:db8::1]:1234" / "1.2.3.4:5678" の形式はポートを除く
  const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(ip);
  if (bracket) return bracket[1];
  const v4port = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(ip);
  return v4port ? v4port[1] : ip;
}
