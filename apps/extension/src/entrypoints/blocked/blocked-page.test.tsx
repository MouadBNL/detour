import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vite-plus/test";
import { BlockedPage } from "./blocked-page.tsx";

describe("BlockedPage", () => {
  it("shows the intercepted host and submits a duration and reason", async () => {
    render(<BlockedPage search="?url=https%3A%2F%2Fexample.com%2Ffeed" />);

    expect(screen.getByRole("heading", { name: "example.com" })).toBeTruthy();

    await userEvent.click(screen.getByRole("radio", { name: /15 minutes/i }));
    await userEvent.type(screen.getByLabelText("Why now?"), "Checking docs");
    await userEvent.click(screen.getByRole("button", { name: "Request pass" }));

    expect(screen.getByRole("status").textContent).toBe(
      'Requested 15 minutes for "Checking docs".',
    );
  });
});
