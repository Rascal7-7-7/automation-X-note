// Auth is handled via HttpOnly cookie (set by /api/auth/login).
// credentials: 'include' ensures the cookie is sent on same-origin requests.
export async function apiFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const isFormData = opts.body instanceof FormData;
  return fetch(url, {
    ...opts,
    credentials: 'include',
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(opts.headers as Record<string, string> | undefined),
    },
  });
}
