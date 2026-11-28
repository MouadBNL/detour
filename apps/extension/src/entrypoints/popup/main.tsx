import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../styles.css";
import { createQueryClient } from "../../lib/query-client.ts";
import { PopupApp } from "./popup-app.tsx";

const root = document.getElementById("root");
const queryClient = createQueryClient();

if (root) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <PopupApp />
      </QueryClientProvider>
    </StrictMode>,
  );
}
