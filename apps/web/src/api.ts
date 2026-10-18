import { useAuth0 } from "@auth0/auth0-react";
import { useCallback } from "react";
import { API_BASE_URL } from "./config.js";

/** fetch for our API, with the signed-in user's access token attached. */
export function useApi() {
  const { getAccessTokenSilently } = useAuth0();

  return useCallback(
    async (path: string, init: RequestInit = {}) => {
      const token = await getAccessTokenSilently();
      if (!token) throw new Error("No access token available");
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${token}`);
      return fetch(`${API_BASE_URL}${path}`, { ...init, headers });
    },
    [getAccessTokenSilently],
  );
}
