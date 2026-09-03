// "Does this URL point at this machine?" — the one answer offline mode relies
// on for local LLM providers, the vision engine and the external speech
// server alike. Host names are matched exactly (plus the .localhost TLD, which
// resolves to loopback by RFC 6761): "localhost.evil.com" must not read as
// local, and neither must a LAN address.

export function isLoopbackUrl(url) {
  try {
    const host = new URL(String(url)).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost');
  } catch {
    return false;
  }
}
