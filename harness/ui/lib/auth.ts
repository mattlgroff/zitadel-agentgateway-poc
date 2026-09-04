const issuer = process.env.NEXT_PUBLIC_ZITADEL_ISSUER ?? "http://localhost:8080";
const clientId = process.env.NEXT_PUBLIC_ZITADEL_CLIENT_ID ?? "";

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export async function beginLogin(): Promise<void> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const state = base64Url(crypto.getRandomValues(new Uint8Array(24)));
  sessionStorage.setItem("pkce_verifier", verifier);
  sessionStorage.setItem("oauth_state", state);
  const url = new URL(`${issuer}/oauth/v2/authorize`);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: "http://localhost:3100/callback",
    response_type: "code",
    scope: "openid profile email",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  }).toString();
  location.assign(url);
}

export async function finishLogin(code: string, state: string): Promise<void> {
  const verifier = sessionStorage.getItem("pkce_verifier");
  if (!verifier || state !== sessionStorage.getItem("oauth_state")) throw new Error("Invalid OAuth state");
  const response = await fetch(`${issuer}/oauth/v2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, redirect_uri: "http://localhost:3100/callback", code, code_verifier: verifier }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error_description ?? "Token exchange failed");
  localStorage.setItem("access_token", result.access_token);
  sessionStorage.removeItem("pkce_verifier");
  sessionStorage.removeItem("oauth_state");
}

export function token(): string | null {
  return typeof window === "undefined" ? null : localStorage.getItem("access_token");
}

