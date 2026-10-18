import { type Profile, ProfileSchema } from "@ai-wellness-coach/shared";
import { useAuth0 } from "@auth0/auth0-react";
import { useEffect, useState } from "react";
import { useApi } from "./api.js";

type ProfileState =
  | { status: "loading" }
  | { status: "ready"; profile: Profile }
  | { status: "error" };

export function Home() {
  const { user, logout } = useAuth0();
  const api = useApi();
  const [state, setState] = useState<ProfileState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      try {
        // Creates the profile on first sign-in; afterwards it just returns it.
        const res = await api("/me", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
        });
        if (!res.ok)
          throw new Error(`POST /me failed with ${String(res.status)}`);
        const profile = ProfileSchema.parse(await res.json());
        if (!cancelled) setState({ status: "ready", profile });
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    }

    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const name = user?.given_name ?? user?.name;

  return (
    <main>
      <h1>{name ? `Welcome, ${name}!` : "Welcome!"}</h1>
      {state.status === "loading" && <p>Setting up your space...</p>}
      {state.status === "ready" && (
        <p>Your days follow the {state.profile.timezone} time zone.</p>
      )}
      {state.status === "error" && (
        <p role="alert">
          We couldn't load your profile right now. Please try again in a moment.
        </p>
      )}
      <button
        type="button"
        onClick={() =>
          void logout({ logoutParams: { returnTo: window.location.origin } })
        }
      >
        Sign out
      </button>
    </main>
  );
}
