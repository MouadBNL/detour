import { describe, expect, it } from "vite-plus/test";
import { parseBlockedTarget } from "./blocked-target.ts";

describe("parseBlockedTarget", () => {
  it("parses a percent-encoded https url query param", () => {
    const result = parseBlockedTarget("?url=https%3A%2F%2Fnews.ycombinator.com%2Fnewest");
    expect(result).toEqual({
      ok: true,
      value: {
        host: "news.ycombinator.com",
        href: "https://news.ycombinator.com/newest",
      },
    });
  });

  it("preserves full query strings injected verbatim by DNR regexSubstitution", () => {
    const result = parseBlockedTarget("?url=https://example.com/search?a=1&b=2&c=3");
    expect(result).toEqual({
      ok: true,
      value: {
        host: "example.com",
        href: "https://example.com/search?a=1&b=2&c=3",
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

  it("keeps the fragment of a verbatim target url", () => {
    expect(parseBlockedTarget("?url=https://example.com/page?a=1#section-2")).toEqual({
      ok: true,
      value: { host: "example.com", href: "https://example.com/page?a=1#section-2" },
    });
  });

  it("uses the outer host when the target itself carries a nested ?url=", () => {
    expect(parseBlockedTarget("?url=https://example.com/out?url=https://evil.com/x")).toEqual({
      ok: true,
      value: { host: "example.com", href: "https://example.com/out?url=https://evil.com/x" },
    });
  });

  it("does not let an unencoded &url= in the target override the host", () => {
    expect(parseBlockedTarget("?url=https://example.com/a?x=1&url=https://evil.com")).toEqual({
      ok: true,
      value: { host: "example.com", href: "https://example.com/a?x=1&url=https://evil.com" },
    });
  });

  it("decodes a percent-encoded target that contains its own query and fragment", () => {
    const target = "https://sub.example.com/feed?q=a&b=c#top";
    expect(parseBlockedTarget(`?url=${encodeURIComponent(target)}`)).toEqual({
      ok: true,
      value: { host: "sub.example.com", href: target },
    });
  });
});
