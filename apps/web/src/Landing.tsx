import { useAuth0 } from "@auth0/auth0-react";

export function Landing({ notice }: { notice?: string }) {
  const { loginWithRedirect } = useAuth0();

  return (
    <main>
      <h1>AI Wellness Coach</h1>
      <p>
        Log how you move, rest, and feel in your own words, and discover what
        helps you feel your best.
      </p>
      {notice && <p role="alert">{notice}</p>}
      <button type="button" onClick={() => void loginWithRedirect()}>
        Sign in
      </button>
    </main>
  );
}
