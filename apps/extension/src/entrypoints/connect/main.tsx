import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../styles.css";
import { ConnectPage } from "./connect-page.tsx";

const root = document.getElementById("root");

if (root) {
  createRoot(root).render(
    <StrictMode>
      <ConnectPage />
    </StrictMode>,
  );
}
