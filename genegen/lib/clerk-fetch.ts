import { API_BASE_URL } from "@/lib/api-base";

/**
 * Call the FastAPI backend with a Clerk session JWT (Authorization: Bearer …).
 */
export async function fetchWithClerk(
  getToken: () => Promise<string | null>,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await getToken();
  if (!token) {
    throw new Error("You must be signed in.");
  }
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const url = path.startsWith("http") ? path : `${API_BASE_URL}${path}`;
  return fetch(url, { ...init, headers });
}
