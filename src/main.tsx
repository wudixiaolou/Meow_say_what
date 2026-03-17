import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./appnew.tsx";
import "./index.css";

const isLanIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(window.location.hostname);
if (window.location.protocol === "http:" && isLanIp) {
  window.location.replace(`https://${window.location.host}${window.location.pathname}${window.location.search}${window.location.hash}`);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
