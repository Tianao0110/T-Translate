// "Does this URL point at this machine?": the one answer offline mode relies
// on for local LLM providers, the vision engine and the external speech
// server. Host names are matched exactly, plus the .localhost TLD (RFC 6761).

export function isLoopbackUrl(url) {
  try {
    const host = new URL(String(url)).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost');
  } catch {
    return false;
  }
}
