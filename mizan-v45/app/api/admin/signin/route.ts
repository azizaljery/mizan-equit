// Guarded by Cloudflare Access (/api/admin/*). Reaching this handler with a verified
// owner identity means sign-in succeeded; send the owner back to where they started.
import { safeReturn } from '@/lib/safe-return';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const email = req.headers.get('cf-access-authenticated-user-email');
  if (!email) return new Response('يلزم تسجيل الدخول بحساب مالك ميزان.', { status: 401, headers: { 'Cache-Control': 'no-store' } });
  return Response.redirect(new URL(safeReturn(url.searchParams.get('return_to'), url.origin), url.origin).toString(), 302);
}
