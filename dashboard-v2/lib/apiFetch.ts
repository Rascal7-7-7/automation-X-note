// Requires NEXT_PUBLIC_DASHBOARD_SECRET in .env.local set to the same value as DASHBOARD_SECRET.
// NEXT_PUBLIC_ prefix is intentional: this is a local developer dashboard, not a public endpoint.
export async function apiFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const secret = process.env.NEXT_PUBLIC_DASHBOARD_SECRET ?? '';
  const { headers: callerHeaders, ...rest } = opts;
  const isFormData = opts.body instanceof FormData;
  const headers = new Headers(callerHeaders as HeadersInit | undefined);
  if (opts.body !== undefined && !isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (secret) headers.set('x-dashboard-secret', secret);
  return fetch(url, { ...rest, headers });
}
