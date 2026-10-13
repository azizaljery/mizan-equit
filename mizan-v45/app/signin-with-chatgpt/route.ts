// Legacy ChatGPT-hosting sign-in path. Existing links keep working: they now go through
// Cloudflare Access (via /api/admin/signin) and return to the requested page.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const target = new URL('/api/admin/signin', url.origin);
  const back = url.searchParams.get('return_to');
  if (back) target.searchParams.set('return_to', back);
  return Response.redirect(target.toString(), 302);
}
