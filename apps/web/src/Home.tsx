import { type Profile, ProfileSchema } from "@ai-wellness-coach/shared";
import { useAuth0 } from "@auth0/auth0-react";
import { useEffect, useState } from "react";
import { useApi } from "./api.js";
import { Chat } from "./Chat.js";
import { DayView } from "./DayView.js";

type View = "chat" | "day";

type ProfileState =
  | { status: "loading" }
  | { status: "ready"; profile: Profile }
  | { status: "error" };

export function Home() {
  const { user, logout } = useAuth0();
  const api = useApi();
  const [state, setState] = useState<ProfileState>({ status: "loading" });
  const [view, setView] = useState<View>("chat");

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
    <main className="home">
      <header className="home-header">
        <div>
          <h1>{name ? `Welcome, ${name}!` : "Welcome!"}</h1>
          {state.status === "ready" && (
            <p className="home-zone">
              Your days follow the {state.profile.timezone} time zone.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() =>
            void logout({ logoutParams: { returnTo: window.location.origin } })
          }
        >
          Sign out
        </button>
      </header>
      {state.status === "loading" && (
        <p className="chat-status">Setting up your space...</p>
      )}
      {state.status === "error" && (
        <p className="chat-status" role="alert">
          We couldn't load your profile right now. Please try again in a moment.
        </p>
      )}
      {state.status === "ready" && (
        <nav className="home-tabs" aria-label="Views">
          <button
            type="button"
            aria-pressed={view === "chat"}
            onClick={() => {
              setView("chat");
            }}
          >
            Chat
          </button>
          <button
            type="button"
            aria-pressed={view === "day"}
            onClick={() => {
              setView("day");
            }}
          >
            My day
          </button>
        </nav>
      )}
      {/* The chat needs the profile, which POST /me creates on first sign-in.
          It stays mounted while hidden, so a conversation in progress survives
          a look at the day. */}
      {state.status === "ready" && (
        <div className="home-view" hidden={view !== "chat"}>
          <Chat />
        </div>
      )}
      {state.status === "ready" && view === "day" && (
        <div className="home-view">
          <DayView timeZone={state.profile.timezone} />
        </div>
      )}
    </main>
  );
}
