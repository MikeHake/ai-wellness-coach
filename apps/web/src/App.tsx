import { useAuth0 } from "@auth0/auth0-react";
import { Home } from "./Home.js";
import { Landing } from "./Landing.js";

export function App() {
  const { isLoading, isAuthenticated, error } = useAuth0();

  if (isLoading) {
    return (
      <main>
        <p>Getting things ready...</p>
      </main>
    );
  }
  if (error) {
    return (
      <Landing notice="Signing in didn't work that time. Please try again." />
    );
  }
  return isAuthenticated ? <Home /> : <Landing />;
}
