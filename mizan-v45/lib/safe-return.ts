// Same-origin only: control characters (tab/CR/LF are stripped by the URL parser, so `/\t/evil.com` would become
// `//evil.com`) and backslashes are rejected, and the resolved URL must keep this origin.
export const safeReturn = (value: string | null, origin = 'https://invalid.local') => {
  if (!value || !/^\/(?!\/)[^\\\x00-\x1f\x7f]*$/.test(value)) return '/';
  try { const u = new URL(value, origin); return u.origin === origin ? u.pathname + u.search + u.hash : '/'; } catch { return '/'; }
};
