import { describe, expect, it } from "vitest";
import {
  evalFrameExpr,
  evalParamExpr,
  clamp01,
  easeOutBack,
  easeOutCubic,
  envelope,
  type FrameExprCtx,
  type FrameExprNode,
} from "@dopamine/core";

const ctx = (over: Partial<FrameExprCtx> = {}): FrameExprCtx => ({
  animMs: 250,
  life: 0.25,
  elapsedMs: 300,
  params: { overshoot: 0.7, scale: 0.5 },
  ...over,
});

describe("evalFrameExpr (the per-frame grammar)", () => {
  it("evaluates literals, consts, params and inputs", () => {
    expect(evalFrameExpr(3.5, ctx())).toBe(3.5);
    expect(evalFrameExpr({ const: -2 }, ctx())).toBe(-2);
    expect(evalFrameExpr({ param: "overshoot" }, ctx())).toBe(0.7);
    expect(evalFrameExpr({ input: "animMs" }, ctx())).toBe(250);
    expect(evalFrameExpr({ input: "life" }, ctx())).toBe(0.25);
    expect(evalFrameExpr({ input: "elapsedMs" }, ctx())).toBe(300);
  });

  it("evaluates the loop clocks (tempo.loop): supplied by the caller, 0 without a loop", () => {
    expect(evalFrameExpr({ input: "loopS" }, ctx({ loopS: 0.25, phase: 1 / 6 }))).toBe(0.25);
    expect(evalFrameExpr({ input: "phase" }, ctx({ loopS: 0.25, phase: 1 / 6 }))).toBe(1 / 6);
    // A doc without tempo.loop gets the calm defaults, not a throw.
    expect(evalFrameExpr({ input: "loopS" }, ctx())).toBe(0);
    expect(evalFrameExpr({ input: "phase" }, ctx())).toBe(0);
  });

  it("throws on a missing/non-numeric param and an unknown input", () => {
    expect(() => evalFrameExpr({ param: "nope" }, ctx())).toThrow(/param/);
    expect(() => evalFrameExpr({ param: "palette" }, ctx({ params: { palette: [1] } }))).toThrow(/param/);
    expect(() => evalFrameExpr({ input: "wat" } as unknown as FrameExprNode, ctx())).toThrow(/input/);
    expect(() => evalFrameExpr({ frob: 1 } as unknown as FrameExprNode, ctx())).toThrow(/unknown/);
  });

  it("evaluates arithmetic with evalExpr's reduce semantics", () => {
    expect(evalFrameExpr({ add: [1, 2, 3] }, ctx())).toBe(6);
    expect(evalFrameExpr({ sub: [10, 3, 2] }, ctx())).toBe(5); // left fold from first
    expect(evalFrameExpr({ sub: [1, { input: "life" }] }, ctx())).toBe(0.75);
    expect(evalFrameExpr({ mul: [2, 3, 4] }, ctx())).toBe(24);
    expect(evalFrameExpr({ div: [12, 3, 2] }, ctx())).toBe(2); // left fold from first
    expect(evalFrameExpr({ div: [1, 0] }, ctx())).toBe(Infinity); // plain IEEE division
    expect(evalFrameExpr({ min: [3, 1, 2] }, ctx())).toBe(1);
    expect(evalFrameExpr({ max: [3, 1, 2] }, ctx())).toBe(3);
    expect(evalFrameExpr({ pow: [2, 10] }, ctx())).toBe(1024);
  });

  it("evaluates the math + tempo primitives identically to engine/tempo", () => {
    expect(evalFrameExpr({ sin: 1.2 }, ctx())).toBe(Math.sin(1.2));
    expect(evalFrameExpr({ exp: -0.5 }, ctx())).toBe(Math.exp(-0.5));
    expect(evalFrameExpr({ clamp01: 1.7 }, ctx())).toBe(clamp01(1.7));
    expect(evalFrameExpr({ envelope: [{ input: "life" }, { param: "overshoot" }] }, ctx())).toBe(
      envelope(0.25, 0.7),
    );
    expect(evalFrameExpr({ easeOutCubic: 0.3 }, ctx())).toBe(easeOutCubic(0.3));
    expect(evalFrameExpr({ easeOutBack: [0.3, 0.7] }, ctx())).toBe(easeOutBack(0.3, 0.7));
  });

  it("lt picks (and lazily evaluates) the right branch", () => {
    expect(evalFrameExpr({ lt: [1, 2, 10, 20] }, ctx())).toBe(10);
    expect(evalFrameExpr({ lt: [2, 1, 10, 20] }, ctx())).toBe(20);
    expect(evalFrameExpr({ lt: [1, 1, 10, 20] }, ctx())).toBe(20); // strict <
    // The untaken branch is never evaluated (a missing param there cannot throw).
    expect(evalFrameExpr({ lt: [1, 2, 10, { param: "nope" }] }, ctx())).toBe(10);
  });
});

describe("evalParamExpr (params-only, e.g. shadowHeightFrac)", () => {
  it("evaluates pure-param expressions", () => {
    expect(evalParamExpr({ mul: [{ param: "scale" }, 0.5] }, { scale: 0.8 })).toBe(0.4);
    expect(evalParamExpr(0.42, {})).toBe(0.42);
  });

  it("THROWS on {input} — shadow geometry must not read the frame clock", () => {
    expect(() => evalParamExpr({ input: "life" }, {})).toThrow(/input/);
  });
});
