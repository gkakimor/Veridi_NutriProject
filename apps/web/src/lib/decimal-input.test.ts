import { describe, expect, it } from "vitest";
import { formatDecimalInput } from "./decimal-input";

describe("decimal canônico de volta para português", () => {
  it("formata de volta para português sem mexer na precisão", () => {
    expect(formatDecimalInput("0.85")).toBe("0,85");
    expect(formatDecimalInput("1234.5000")).toBe("1234,5000");
    expect(formatDecimalInput("10")).toBe("10");
    expect(formatDecimalInput(null)).toBe("");
    expect(formatDecimalInput(undefined)).toBe("");
    expect(formatDecimalInput("")).toBe("");
  });
});
