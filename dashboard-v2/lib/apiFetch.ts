// Requires NEXT_PUBLIC_DASHBOARD_SECRET in .env.local set to the same value as DASHBOARD_SECRET.
// NEXT_PUBLIC_ prefix is intentional: this is a local developer dashboard, not a public endpoint.
export async function apiFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const secret = process.env.NEXT_PUBLIC_DASHBOARD_SECRET ?? '';
  const { headers: extraHeaders, ...rest } = opts;
  return fetch(url, {
    ...rest,
    headers: {
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(extraHeaders as Record<string, string> | undefined),
      ...(secret ? { 'x-dashboard-secret': secret } : {}),
    },
  });
}
