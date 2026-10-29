import { describe, expect, it } from "vitest";
import { formatSessionCredits } from "./session-credits";

describe("exact decimal credits display", () => {
  it.each([
    ["12.34", "12.34"], ["0E-10", "0.00"], ["-0", "0.00"], ["0", "0.00"],
    ["-12.345", "-12.34"], ["1e-20", "1e-20"], ["1.2345e2", "123.45"],
    ["0.000004", "0.0000040"], ["1.000000000000000002", "1.00"],
    ["NaN", "—"], ["9007199254740993", "9.007199e+15"],
  ])("formats %s as %s", (input, output) => expect(formatSessionCredits(input)).toBe(output));
});
