import { describe, expect, it } from "vite-plus/test";
import { parseBlockedTarget } from "./blocked-target.ts";

describe("parseBlockedTarget", () => {
  it("parses a valid https url query param", () => {
    const result = parseBlockedTarget("?url=https%3A%2F%2Fnews.ycombinator.com%2Fnewest");
    expect(result).toEqual({
      ok: true,
      value: {
        host: "news.ycombinator.com",
        href: "https://news.ycombinator.com/newest",
      },
    });
  });

  it("returns missing_url when no url param is provided", () => {
    expect(parseBlockedTarget("")).toEqual({
      ok: false,
      error: { type: "missing_url" },
    });
  });

  it("rejects non-http protocols", () => {
    expect(parseBlockedTarget("?url=javascript:alert(1)")).toEqual({
      ok: false,
      error: { type: "invalid_url", raw: "javascript:alert(1)" },
    });
  });
});
