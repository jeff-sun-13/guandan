import { describe, it, expect } from "vitest";
import { ENGINE_HELLO, ENGINE_VERSION } from "../src/index";

describe("engine smoke test", () => {
  it("exposes a public API", () => {
    expect(ENGINE_HELLO).toContain("Guandan");
    expect(ENGINE_VERSION).toBe("0.0.0");
  });
});
