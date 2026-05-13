import { useState } from "react";

const DEFAULT_AUTH_URL =
  import.meta.env?.VITE_AUTH_URL || "http://127.0.0.1:3000/login";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState({ loading: false, error: "", ok: false });

  async function handleSubmit(event) {
    event.preventDefault();
    if (!username || !password) {
      setStatus({ loading: false, error: "Missing credentials", ok: false });
      return;
    }

    setStatus({ loading: true, error: "", ok: false });

    try {
      const response = await fetch(DEFAULT_AUTH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setStatus({
          loading: false,
          error: payload.error || `Login failed (${response.status})`,
          ok: false,
        });
        return;
      }

      if (!payload.token) {
        setStatus({ loading: false, error: "Token missing", ok: false });
        return;
      }

      if (window.electronAPI?.loginSuccess) {
        window.electronAPI.loginSuccess(payload.token);
      }

      setStatus({ loading: false, error: "", ok: true });
    } catch (err) {
      setStatus({
        loading: false,
        error: err?.message || "Network error",
        ok: false,
      });
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <h2 className="login-title">Cloud IDE Login</h2>
        <p className="login-subtitle">Sign in to get your JWT passport.</p>
        <form className="login-form" onSubmit={handleSubmit}>
          <label className="login-label" htmlFor="login-username">
            Username
          </label>
          <input
            id="login-username"
            className="login-input"
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
          />
          <label className="login-label" htmlFor="login-password">
            Password
          </label>
          <input
            id="login-password"
            className="login-input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
          <button className="login-button" type="submit" disabled={status.loading}>
            {status.loading ? "Logging in..." : "Login"}
          </button>
          {status.error ? (
            <div className="login-error">{status.error}</div>
          ) : null}
          {status.ok ? (
            <div className="login-success">Login success. Token saved.</div>
          ) : null}
        </form>
      </div>
    </div>
  );
}
