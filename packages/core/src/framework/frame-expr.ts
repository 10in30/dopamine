/**
 * Per-FRAME expression evaluator — the datafied form of an effect's `frame()` /
 * `shadowHeightFrac` logic hooks.
 *
 * The resolve-time grammar (`loader.ts` `evalExpr`) maps a feeling into the
 * resolved param bag ONCE per fire. This module is its per-frame sibling: it
 * evaluates the `.dope` `tempo.frame` / `render.shadowHeightFrac` expression
 * trees EVERY frame against the live clocks (`animMs` / `life` / `elapsedMs`,
 * plus the `loopS` / `phase` loop clocks for effects with `tempo.loop`) and
 * the resolved params — so the per-frame logic, like the resolve mapping,
 * is authored once in the `.dope` and interpreted identically on every
 * platform. The same grammar also powers the PER-PASS `render.pass`
 * expressions ({@link evalPassExpr}): params plus the pass-geometry inputs
 * (`targetMinDimPx` / `sdfRange` / `sdfViewBoxW`), with the frame clocks
 * rejected — pass values are computed once per pass, not per frame.
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
  | {
      input:
        | "animMs"
        | "life"
        | "elapsedMs"
        | "loopS"
        | "phase"
        // Pass-geometry inputs — only valid in a `render.pass` expression
        // (evalPassExpr); the frame/params modes reject them.
        | "targetMinDimPx"
        | "sdfRange"
        | "sdfViewBoxW"
        | "dpr";
    }
  | { add: FrameExprNode[] }
  | { sub: FrameExprNode[] }
  | { mul: FrameExprNode[] }
  | { div: FrameExprNode[] }
  | { min: FrameExprNode[] }
  | { max: FrameExprNode[] }
  | { pow: [FrameExprNode, FrameExprNode] }
  | { sin: FrameExprNode }
  | { cos: FrameExprNode }
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
  /**
   * Seconds within the current loop (`(animMs % tempo.loop.periodMs) / 1000`).
   * 0 for an effect with no `tempo.loop` — the caller (the dope-pass frame
   * derivation) fills these from the doc's loop contract.
   */
  loopS?: number;
  /** Normalized loop phase in [0, 1) (`animMs % periodMs / periodMs`); 0 without a loop. */
  phase?: number;
  /** Pass-geometry inputs (see {@link PassExprInputs}); only read in "pass" mode. */
  pass?: PassExprInputs;
}

/**
 * The pass-geometry inputs a `render.pass` expression may read (evaluated ONCE
 * per pass by the runners, never per resolve or per frame).
 */
export interface PassExprInputs {
  /**
   * Min dimension of the TARGETED element box in device px, falling back to
   * the full canvas when untargeted — the same target-fallback the standard
   * `uTarget` uniform uses, so a pass-sized centrepiece tracks the element.
   */
  targetMinDimPx: number;
  /**
   * The declared `range` of the SDF behind the first `binding.samplers` entry
   * with an `outline` source (author units → the full byte range); 0 when no
   * sampler declares one.
   */
  sdfRange: number;
  /** That SDF's `viewBox[2]` (author-units width); 0 when absent. */
  sdfViewBoxW: number;
  /**
   * The device-pixel ratio (web `devicePixelRatio` / Android `density` / the
   * Metal layer's content scale) the surface renders at — so a pass value can
   * be expressed in CSS-ish units and scaled to device px (e.g. heartburst's
   * halftone cell `uDotSize = dotSize · dpr`).
   */
  dpr: number;
}

/** Which inputs an expression may read: the three evaluation entry points. */
type ExprMode = "frame" | "params" | "pass";

const FRAME_INPUTS = ["animMs", "life", "elapsedMs", "loopS", "phase"] as const;
const PASS_INPUTS = ["targetMinDimPx", "sdfRange", "sdfViewBoxW", "dpr"] as const;

function evalInput(name: string, ctx: FrameExprCtx, mode: ExprMode): number {
  const isFrame = (FRAME_INPUTS as readonly string[]).includes(name);
  const isPass = (PASS_INPUTS as readonly string[]).includes(name);
  if (mode === "pass") {
    if (isFrame) {
      throw new Error(
        `dope: frame input "${name}" is not allowed in a render.pass expression (pass expressions are not frame-clocked)`,
      );
    }
    if (isPass) return ctx.pass?.[name as keyof PassExprInputs] ?? 0;
    throw new Error(`dope: unknown frame input "${name}"`);
  }
  if (isPass) {
    throw new Error(`dope: pass input "${name}" is only allowed in a render.pass expression`);
  }
  if (mode === "params") {
    throw new Error(`dope: {input} is not allowed in a params-only expression (got "${name}")`);
  }
  if (name === "animMs") return ctx.animMs;
  if (name === "life") return ctx.life;
  if (name === "elapsedMs") return ctx.elapsedMs;
  if (name === "loopS") return ctx.loopS ?? 0;
  if (name === "phase") return ctx.phase ?? 0;
  throw new Error(`dope: unknown frame input "${name}"`);
}

function evalNode(node: FrameExprNode, ctx: FrameExprCtx, mode: ExprMode): number {
  if (typeof node === "number") return node;
  if ("const" in node) return node.const;
  if ("param" in node) {
    const raw = ctx.params[node.param];
    if (typeof raw !== "number") {
      throw new Error(`dope: frame expr references missing/non-numeric param "${node.param}"`);
    }
    return Number(raw);
  }
  if ("input" in node) return evalInput(String(node.input), ctx, mode);
  if ("add" in node) return node.add.reduce((p: number, n) => p + evalNode(n, ctx, mode), 0);
  if ("sub" in node) {
    const parts: number[] = node.sub.map((n) => evalNode(n, ctx, mode));
    return parts.slice(1).reduce((p: number, n: number) => p - n, parts[0] ?? 0);
  }
  if ("mul" in node) return node.mul.reduce((p: number, n) => p * evalNode(n, ctx, mode), 1);
  if ("div" in node) {
    const parts: number[] = node.div.map((n) => evalNode(n, ctx, mode));
    return parts.slice(1).reduce((p: number, n: number) => p / n, parts[0] ?? 0);
  }
  if ("min" in node) return Math.min(...node.min.map((n) => evalNode(n, ctx, mode)));
  if ("max" in node) return Math.max(...node.max.map((n) => evalNode(n, ctx, mode)));
  if ("pow" in node) {
    return Math.pow(evalNode(node.pow[0], ctx, mode), evalNode(node.pow[1], ctx, mode));
  }
  if ("sin" in node) return Math.sin(evalNode(node.sin, ctx, mode));
  if ("cos" in node) return Math.cos(evalNode(node.cos, ctx, mode));
  if ("exp" in node) return Math.exp(evalNode(node.exp, ctx, mode));
  if ("clamp01" in node) return clamp01(evalNode(node.clamp01, ctx, mode));
  if ("lt" in node) {
    // Branches are evaluated LAZILY (only the taken branch), so a guard like
    // `0 < elapsedMs ? f(elapsedMs) : 0` never evaluates f outside its domain.
    const [a, b, then, otherwise] = node.lt;
    return evalNode(a, ctx, mode) < evalNode(b, ctx, mode)
      ? evalNode(then, ctx, mode)
      : evalNode(otherwise, ctx, mode);
  }
  if ("envelope" in node) {
    return envelope(evalNode(node.envelope[0], ctx, mode), evalNode(node.envelope[1], ctx, mode));
  }
  if ("easeOutCubic" in node) return easeOutCubic(evalNode(node.easeOutCubic, ctx, mode));
  if ("easeOutBack" in node) {
    return easeOutBack(evalNode(node.easeOutBack[0], ctx, mode), evalNode(node.easeOutBack[1], ctx, mode));
  }
  throw new Error(`dope: unknown frame expr node ${JSON.stringify(node)}`);
}

/** Evaluate a per-frame grammar node to a number. Pure; throws outside the grammar. */
export function evalFrameExpr(node: FrameExprNode, ctx: FrameExprCtx): number {
  return evalNode(node, ctx, "frame");
}

/**
 * Evaluate a PARAMS-ONLY expression (e.g. `render.shadowHeightFrac`): the same
 * grammar, but `{input}` nodes THROW — a shadow-geometry expression must be a
 * pure function of the resolved params, never of the frame clock.
 */
export function evalParamExpr(node: FrameExprNode, params: Record<string, unknown>): number {
  return evalNode(node, { animMs: 0, life: 0, elapsedMs: 0, params }, "params");
}

/**
 * Evaluate a PER-PASS expression (`render.pass`): the same grammar over the
 * resolved params plus the pass-geometry inputs (`targetMinDimPx` / `sdfRange`
 * / `sdfViewBoxW`). Frame clocks (`animMs` / `life` / …) THROW — a pass
 * expression is evaluated once per pass, not per frame.
 */
export function evalPassExpr(
  node: FrameExprNode,
  params: Record<string, unknown>,
  pass: PassExprInputs,
): number {
  return evalNode(node, { animMs: 0, life: 0, elapsedMs: 0, params, pass }, "pass");
}
