import { describe, expect, it } from "vitest";
import { computeProgressPercent } from "$ui/lib/logic/progress";

describe("computeProgressPercent", () => {
  it("returns null (indeterminate) when total is null", () => {
    expect(computeProgressPercent(0, null)).toBeNull();
    expect(computeProgressPercent(50, null)).toBeNull();
  });

  it("returns null (indeterminate) when total is 0 or negative", () => {
    expect(computeProgressPercent(0, 0)).toBeNull();
    expect(computeProgressPercent(10, -5)).toBeNull();
  });

  it("computes a normal ratio, rounded to the nearest percent", () => {
    expect(computeProgressPercent(50, 200)).toBe(25);
    expect(computeProgressPercent(1, 3)).toBe(33); // 33.33.. -> 33
    expect(computeProgressPercent(2, 3)).toBe(67); // 66.66.. -> 67
  });

  it("caps loaded exceeding total at 100", () => {
    expect(computeProgressPercent(150, 100)).toBe(100);
  });

  it("caps negative loaded at 0", () => {
    expect(computeProgressPercent(-10, 100)).toBe(0);
  });

  it("full/empty edges", () => {
    expect(computeProgressPercent(0, 100)).toBe(0);
    expect(computeProgressPercent(100, 100)).toBe(100);
  });
});
