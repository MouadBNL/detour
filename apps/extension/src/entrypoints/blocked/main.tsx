import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../styles.css";
import { BlockedPage } from "./blocked-page.tsx";

const root = document.getElementById("root");

if (root) {
  createRoot(root).render(
    <StrictMode>
      <BlockedPage search={window.location.search} />
    </StrictMode>,
  );
}
