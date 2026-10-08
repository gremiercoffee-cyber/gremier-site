import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

try {
  const theme = localStorage.getItem("cos.theme");
  if (theme === "light" || theme === "dark") document.documentElement.setAttribute("data-theme", theme);
} catch { /* storage unavailable */ }

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

/** If anything crashes, show a way back instead of a blank white screen. */
class Recover extends Component<{ children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null };
  static getDerivedStateFromError(e: Error) { return { err: e.message || "error" }; }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div style={{ padding: 32, textAlign: "center", fontFamily: "system-ui" }}>
        <p style={{ fontSize: 18, marginBottom: 12 }}>Something went wrong.</p>
        <button onClick={() => location.reload()} style={{ padding: "10px 24px", borderRadius: 999, background: "#3b45a8", color: "white", border: 0, fontSize: 16 }}>Reload</button>
        <p style={{ marginTop: 16, fontSize: 12, color: "#888" }}>{this.state.err}</p>
      </div>
    );
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Recover><App /></Recover>
  </StrictMode>,
);
