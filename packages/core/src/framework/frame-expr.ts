/**
 * Per-FRAME expression evaluator — the datafied form of an effect's `frame()` /
 * `shadowHeightFrac` logic hooks.
 *
 * The resolve-time grammar (`loader.ts` `evalExpr`) maps a feeling into the
 * resolved param bag ONCE per fire. This module is its per-frame sibling: it
 * evaluates the `.dope` `tempo.frame` / `render.shadowHeightFrac` expression
 * trees EVERY frame against the live clocks (`animMs` / `life` / `elapsedMs`)
 * and the resolved params — so the per-frame logic, like the resolve mapping,
 * is authored once in the `.dope` and interpreted identically on every
 * platform.
 *
 * Like `evalExpr`, nodes are evaluated RAW (no decode step) and anything
 * outside the grammar THROWS. The tempo primitives (`envelope`, `easeOutBack`,
 * `easeOutCubic`, `clamp01`) are the SAME functions the hand-written hooks
 * called (imported from `engine/tempo.ts`), so a datafied effect's output is
 * bit-identical to the code it replaced.
 */

import { clamp01, easeOutBack, easeOutCubic, envelope } from "../engine/tempo.js";

/** The per-frame expression grammar — an expression tree over the frame ctx. */
export type FrameExprNode =
  | number
  | { const: number }
  | { param: string }
  | { input: "animMs" | "life" | "elapsedMs" }
  | { add: FrameExprNode[] }
  | { sub: FrameExprNode[] }
  | { mul: FrameExprNode[] }
  | { div: FrameExprNode[] }
  | { min: FrameExprNode[] }
  | { max: FrameExprNode[] }
  | { pow: [FrameExprNode, FrameExprNode] }
  | { sin: FrameExprNode }
  | { exp: FrameExprNode }
  | { clamp01: FrameExprNode }
  | { lt: [FrameExprNode, FrameExprNode, FrameExprNode, FrameExprNode] }
  | { envelope: [FrameExprNode, FrameExprNode] }
  | { easeOutCubic: FrameExprNode }
  | { easeOutBack: [FrameExprNode, FrameExprNode] };

/** Evaluation context for a per-frame expression. */
export interface FrameExprCtx {
  /** The "on twos"-snapped animation clock in ms (stepping already applied). */
  animMs: number;
  /** Normalized life 0..1 (animMs / durationMs, clamped). */
  life: number;
  /** The REAL un-stepped wall clock in ms (mirrors the Swift/Android runners). */
  elapsedMs: number;
  /** The resolved render-param bag (numeric entries are addressable). */
  params: Record<string, unknown>;
}

function evalNode(node: FrameExprNode, ctx: FrameExprCtx, allowInputs: boolean): number {
  if (typeof node === "number") return node;
  if ("const" in node) return node.const;
  if ("param" in node) {
    const raw = ctx.params[node.param];
    if (typeof raw !== "number") {
      throw new Error(`dope: frame expr references missing/non-numeric param "${node.param}"`);
    }
    return Number(raw);
  }
  if ("input" in node) {
    if (!allowInputs) {
      throw new Error(`dope: {input} is not allowed in a params-only expression (got "${node.input}")`);
    }
    if (node.input === "animMs") return ctx.animMs;
    if (node.input === "life") return ctx.life;
    if (node.input === "elapsedMs") return ctx.elapsedMs;
    throw new Error(`dope: unknown frame input "${String(node.input)}"`);
  }
  if ("add" in node) return node.add.reduce((p: number, n) => p + evalNode(n, ctx, allowInputs), 0);
  if ("sub" in node) {
    const parts: number[] = node.sub.map((n) => evalNode(n, ctx, allowInputs));
    return parts.slice(1).reduce((p: number, n: number) => p - n, parts[0] ?? 0);
  }
  if ("mul" in node) return node.mul.reduce((p: number, n) => p * evalNode(n, ctx, allowInputs), 1);
  if ("div" in node) {
    const parts: number[] = node.div.map((n) => evalNode(n, ctx, allowInputs));
    return parts.slice(1).reduce((p: number, n: number) => p / n, parts[0] ?? 0);
  }
  if ("min" in node) return Math.min(...node.min.map((n) => evalNode(n, ctx, allowInputs)));
  if ("max" in node) return Math.max(...node.max.map((n) => evalNode(n, ctx, allowInputs)));
  if ("pow" in node) {
    return Math.pow(evalNode(node.pow[0], ctx, allowInputs), evalNode(node.pow[1], ctx, allowInputs));
  }
  if ("sin" in node) return Math.sin(evalNode(node.sin, ctx, allowInputs));
  if ("exp" in node) return Math.exp(evalNode(node.exp, ctx, allowInputs));
  if ("clamp01" in node) return clamp01(evalNode(node.clamp01, ctx, allowInputs));
  if ("lt" in node) {
    // Branches are evaluated LAZILY (only the taken branch), so a guard like
    // `0 < elapsedMs ? f(elapsedMs) : 0` never evaluates f outside its domain.
    const [a, b, then, otherwise] = node.lt;
    return evalNode(a, ctx, allowInputs) < evalNode(b, ctx, allowInputs)
      ? evalNode(then, ctx, allowInputs)
      : evalNode(otherwise, ctx, allowInputs);
  }
  if ("envelope" in node) {
    return envelope(evalNode(node.envelope[0], ctx, allowInputs), evalNode(node.envelope[1], ctx, allowInputs));
  }
  if ("easeOutCubic" in node) return easeOutCubic(evalNode(node.easeOutCubic, ctx, allowInputs));
  if ("easeOutBack" in node) {
    return easeOutBack(evalNode(node.easeOutBack[0], ctx, allowInputs), evalNode(node.easeOutBack[1], ctx, allowInputs));
  }
  throw new Error(`dope: unknown frame expr node ${JSON.stringify(node)}`);
}

/** Evaluate a per-frame grammar node to a number. Pure; throws outside the grammar. */
export function evalFrameExpr(node: FrameExprNode, ctx: FrameExprCtx): number {
  return evalNode(node, ctx, true);
}

/**
 * Evaluate a PARAMS-ONLY expression (e.g. `render.shadowHeightFrac`): the same
 * grammar, but `{input}` nodes THROW — a shadow-geometry expression must be a
 * pure function of the resolved params, never of the frame clock.
 */
export function evalParamExpr(node: FrameExprNode, params: Record<string, unknown>): number {
  return evalNode(node, { animMs: 0, life: 0, elapsedMs: 0, params }, false);
}
