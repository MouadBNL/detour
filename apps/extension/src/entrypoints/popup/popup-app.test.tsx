import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { PopupApp } from "./popup-app.tsx";

describe("PopupApp", () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it("toggles paused state and persists it to browser storage", async () => {
    render(<PopupApp />);
    const button = screen.getByRole("button", { name: "Pause Detour" });
    await userEvent.click(button);

    expect(await screen.findByRole("status")).toHaveProperty("textContent", "Detour is paused.");
    expect(screen.getByRole("button", { name: "Resume Detour" })).toBeTruthy();
  });
});
