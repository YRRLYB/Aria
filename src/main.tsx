import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// The desktop shell reports its platform so the chrome can match it (macOS keeps
// the native traffic lights and needs room for them in the header).
const desktopPlatform = window.ariaDesktop?.platform;
if (desktopPlatform) document.documentElement.dataset.platform = desktopPlatform;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
