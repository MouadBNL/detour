import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../styles.css";
import { PopupApp } from "./popup-app.tsx";

const root = document.getElementById("root");

if (root) {
  createRoot(root).render(
    <StrictMode>
      <PopupApp />
    </StrictMode>,
  );
}
