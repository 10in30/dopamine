/**
 * dopamine toolchain — restricted TypeScript-subset → Swift + Kotlin transpiler
 * for CPU-precomputed per-frame GEOMETRY logic (the roadmap's "transpiler for
 * CPU-precomputed per-frame geometry").
 *
 * Some effects (lightning) precompute fragment-independent geometry on the CPU
 * each frame and feed it to the shader as uniform arrays / fragment buffers.
 * That logic used to be hand-written THREE times (TS / Swift / Kotlin). This is
 * the scoped, mechanical translator that makes the web module the SINGLE source:
 * the `.dope` declares an `x-build.logic` block ({ src, parityFixture }) and
 * `dopamine build` generates `<Name>Renderer.swift` / `<Name>Renderer.kt` from
 * the one TS file — same posture as the GLSL→MSL transpiler in shader.mjs: it
 * covers EXACTLY the subset the source uses and THROWS on anything outside it.
 *
 * Supported subset (numeric semantics are JS's — see the source-file contract):
 *   • a self-contained module: NO imports; `export const` integer constants;
 *     interfaces typing {x,y} vector structs and the {Float32Array…} bundle the
 *     entry function returns; function declarations with typed params.
 *   • const/let, if/else, canonical `for (let i = A; i < B|<=B; i++)` loops,
 *     break/continue/return, ternaries, arithmetic, comparisons, unary minus.
 *   • Math.{floor,min,max,abs,sqrt,exp,hypot,sin,cos,pow,round} + Math.PI;
 *     `new Float32Array(n)`; Float32Array element writes (narrowing to float32,
 *     like the web's typed-array stores); `{x: …, y: …}` struct literals.
 *
 * Typing: every number is a DOUBLE (matching JS) except integer-literal consts
 * and loop counters, which become native ints; `/` is always double division;
 * `Math.round(x)` is emitted as `floor(x + 0.5)` (JS Math.round semantics).
 * Operation order is preserved exactly — only libm transcendentals may differ
 * by ULPs across platforms, which the parity fixtures absorb with a tight
 * relative epsilon.
 *
 * VERIFICATION: the generated Swift/Kotlin are gated byte-for-byte against
 * committed snapshots (tools/dopamine/test/logic.test.mjs, golden-logic/), and
 * NUMERICALLY against a committed fixture dumped from the web module: a
 * generated pure-JVM JUnit test (synced into dopamine-core's testGenerated
 * source set) and a generated XCTest target in the dist SwiftPM package replay
 * the same grid and assert every output float.
 */

import ts from "typescript";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const pascal = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Math.* member → emission strategy (shared name = same fn name on both). */
const MATH_FNS = new Set([
  "floor", "min", "max", "abs", "sqrt", "exp", "hypot", "sin", "cos", "pow", "round",
]);
/** kotlin.math imports needed per used intrinsic. */
const KOTLIN_MATH_IMPORTS = {
  floor: "kotlin.math.floor",
  abs: "kotlin.math.abs",
  sqrt: "kotlin.math.sqrt",
  exp: "kotlin.math.exp",
  hypot: "kotlin.math.hypot",
  sin: "kotlin.math.sin",
  cos: "kotlin.math.cos",
  pow: "kotlin.math.pow",
  PI: "kotlin.math.PI",
  round: "kotlin.math.floor", // Math.round(x) → floor(x + 0.5)
};

const fail = (node, msg) => {
  let loc = "";
  if (node && typeof node.getStart === "function") {
    const sf = node.getSourceFile();
    const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart());
    loc = ` at ${line + 1}:${character + 1}: ${node.getText().slice(0, 80)}`;
  }
  throw new Error(`logic: unsupported construct${loc} — ${msg}`);
};

const hasExport = (node) =>
  (ts.getModifiers?.(node) ?? node.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

/** TS type-node → our type string. */
function typeFromAnnotation(typeNode, interfaces, node) {
  if (!typeNode) fail(node, "missing type annotation");
  const text = typeNode.getText();
  if (text === "number") return "double";
  if (text === "Float32Array") return "farray";
  if (text === "void") return "void";
  if (interfaces[text]) return (interfaces[text].kind === "bundle" ? "bundle:" : "struct:") + text;
  fail(typeNode, `unknown type '${text}'`);
}

const isNumeric = (t) => t === "double" || t === "int" || t === "intlit";
const combineNum = (a, b, node) => {
  if (!isNumeric(a) || !isNumeric(b)) fail(node, `non-numeric arithmetic operands (${a}, ${b})`);
  if (a === "double" || b === "double") return "double";
  if (a === "int" || b === "int") return "int";
  return "intlit";
};

/**
 * Parse the module into the model: interfaces, consts, functions (+ per-function
 * inferred local/param types, mutated params, written arrays).
 */
export function parseLogicModule(source, fileName = "logic.ts") {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true);
  const interfaces = {}; // name → { kind: 'struct'|'bundle', fields: [name], exported }
  const consts = []; // { name, init, type, exported }
  const constTypes = {}; // name → type
  const functions = []; // { name, params, returnType, body, exported, … }
  const fnSigs = {}; // name → { params, returnType }

  for (const stmt of sf.statements) {
    if (ts.isInterfaceDeclaration(stmt)) {
      const fields = [];
      let kind = null;
      for (const m of stmt.members) {
        if (!ts.isPropertySignature(m) || !m.type) fail(m, "interface members must be typed properties");
        const t = m.type.getText();
        const k = t === "number" ? "struct" : t === "Float32Array" ? "bundle" : fail(m, "interface fields must be number or Float32Array");
        if (kind && kind !== k) fail(m, "interfaces must be all-number (struct) or all-Float32Array (bundle)");
        kind = k;
        fields.push(m.name.getText());
      }
      interfaces[stmt.name.text] = { kind, fields, exported: hasExport(stmt) };
      continue;
    }
    if (ts.isVariableStatement(stmt)) {
      if (!(stmt.declarationList.flags & ts.NodeFlags.Const)) fail(stmt, "top-level variables must be const");
      for (const d of stmt.declarationList.declarations) {
        const name = d.name.getText();
        const type = constExprType(d.initializer, constTypes);
        consts.push({ name, init: d.initializer, type, exported: hasExport(stmt) });
        constTypes[name] = type;
      }
      continue;
    }
    if (ts.isFunctionDeclaration(stmt)) {
      const name = stmt.name?.text ?? fail(stmt, "anonymous function");
      const params = stmt.parameters.map((p) => {
        if (p.dotDotDotToken || p.initializer || !ts.isIdentifier(p.name)) {
          fail(p, "params must be plain typed identifiers");
        }
        return { name: p.name.text, type: typeFromAnnotation(p.type, interfaces, p) };
      });
      const returnType = stmt.type ? typeFromAnnotation(stmt.type, interfaces, stmt) : "void";
      const fn = { name, params, returnType, body: stmt.body, exported: hasExport(stmt) };
      functions.push(fn);
      fnSigs[name] = fn;
      continue;
    }
    if (ts.isImportDeclaration(stmt)) fail(stmt, "the logic module must be self-contained (no imports)");
    fail(stmt, `unsupported top-level statement (kind ${ts.SyntaxKind[stmt.kind]})`);
  }

  const model = { sf, interfaces, consts, constTypes, functions, fnSigs };
  for (const fn of functions) analyzeFunction(fn, model);

  const entries = functions.filter((f) => f.exported && f.returnType.startsWith("bundle:"));
  if (entries.length !== 1) {
    throw new Error(`logic: expected exactly ONE exported bundle-returning entry function, found ${entries.length}`);
  }
  model.entry = entries[0];
  return model;
}

/** Type of a top-level const initializer (integer-literal arithmetic → int). */
function constExprType(node, constTypes) {
  if (!node) fail(node, "const without initializer");
  if (ts.isNumericLiteral(node)) return /^[0-9]+$/.test(node.text) ? "int" : "double";
  if (ts.isIdentifier(node)) return constTypes[node.text] ?? fail(node, `unknown const '${node.text}'`);
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.getText();
    if (!["+", "-", "*"].includes(op)) fail(node, "const initializers support + - * only");
    const a = constExprType(node.left, constTypes);
    const b = constExprType(node.right, constTypes);
    return a === "int" && b === "int" ? "int" : "double";
  }
  if (ts.isParenthesizedExpression(node)) return constExprType(node.expression, constTypes);
  fail(node, "const initializers must be numeric-literal arithmetic");
}

/**
 * Infer local-variable types for one function (fixpoint: an int-initialized
 * `let` later assigned a double is PROMOTED to double), and record param
 * mutations + Float32Array params that receive element writes.
 */
function analyzeFunction(fn, model) {
  const env = new Map(); // name → { type, mutable, isParam }
  for (const p of fn.params) env.set(p.name, { type: p.type, mutable: true, isParam: true });
  fn.env = env;
  fn.mutatedParams = new Set();
  fn.writtenArrays = new Set();

  const typeOf = (node) => exprType(node, env, model, fn);

  let changed = true;
  let guard = 0;
  while (changed) {
    changed = false;
    if (++guard > 10) throw new Error(`logic: type inference did not converge in ${fn.name}`);

    const visitStmt = (stmt) => {
      if (ts.isVariableStatement(stmt)) {
        const isConst = !!(stmt.declarationList.flags & ts.NodeFlags.Const);
        for (const d of stmt.declarationList.declarations) {
          if (!ts.isIdentifier(d.name)) fail(d, "destructuring declarations are unsupported");
          const name = d.name.text;
          let t = typeOf(d.initializer ?? fail(d, "declaration without initializer"));
          if (t === "intlit") t = "int";
          const prev = env.get(name);
          if (prev && !prev.fromDecl) fail(d, `redeclaration of '${name}'`);
          if (!prev || prev.type !== t) {
            // Keep an earlier double-promotion sticky across re-analysis passes.
            if (prev && prev.type === "double" && t === "int") t = "double";
            env.set(name, { type: t, mutable: !isConst, isParam: false, fromDecl: true });
          }
        }
        return;
      }
      if (ts.isExpressionStatement(stmt)) {
        const e = stmt.expression;
        if (ts.isBinaryExpression(e) && /^(=|\+=|-=|\*=|\/=)$/.test(e.operatorToken.getText())) {
          const rhsT = typeOf(e.right);
          if (ts.isIdentifier(e.left)) {
            const v = env.get(e.left.text) ?? fail(e, `assignment to unknown '${e.left.text}'`);
            if (v.isParam) fn.mutatedParams.add(e.left.text);
            const wantsDouble = rhsT === "double" || e.operatorToken.getText() === "/=";
            if (v.type === "int" && wantsDouble) { v.type = "double"; changed = true; }
            return;
          }
          if (ts.isElementAccessExpression(e.left)) {
            const arrT = typeOf(e.left.expression);
            if (arrT !== "farray") fail(e, "element writes are only supported on Float32Array");
            if (ts.isIdentifier(e.left.expression) && env.get(e.left.expression.text)?.isParam) {
              fn.writtenArrays.add(e.left.expression.text);
            }
            typeOf(e.right);
            return;
          }
          fail(e, "unsupported assignment target");
        }
        fail(stmt, "expression statements must be assignments");
      }
      if (ts.isIfStatement(stmt)) {
        typeOf(stmt.expression);
        visitBody(stmt.thenStatement);
        if (stmt.elseStatement) visitBody(stmt.elseStatement);
        return;
      }
      if (ts.isForStatement(stmt)) {
        const { counter } = forParts(stmt);
        if (!env.has(counter)) env.set(counter, { type: "int", mutable: false, isParam: false, fromDecl: true });
        visitBody(stmt.statement);
        return;
      }
      if (ts.isReturnStatement(stmt)) { if (stmt.expression) typeOf(stmt.expression); return; }
      if (ts.isBreakStatement(stmt) || ts.isContinueStatement(stmt)) return;
      fail(stmt, `unsupported statement (kind ${ts.SyntaxKind[stmt.kind]})`);
    };
    const visitBody = (s) => {
      if (ts.isBlock(s)) { for (const st of s.statements) visitStmt(st); }
      else visitStmt(s);
    };
    visitBody(fn.body);
  }
}

/** Validate + destructure the canonical `for (let i = A; i (<|<=) B; i++)`. */
function forParts(stmt) {
  const init = stmt.initializer;
  if (!init || !ts.isVariableDeclarationList(init) || init.declarations.length !== 1) {
    fail(stmt, "for-loops must declare exactly one counter (`let i = …`)");
  }
  const d = init.declarations[0];
  if (!ts.isIdentifier(d.name) || !d.initializer) fail(stmt, "for-loop counter must be `let i = <expr>`");
  const cond = stmt.condition;
  if (!cond || !ts.isBinaryExpression(cond) || !ts.isIdentifier(cond.left) || cond.left.text !== d.name.text) {
    fail(stmt, "for-loop condition must compare the counter (`i < B` / `i <= B`)");
  }
  const op = cond.operatorToken.getText();
  if (op !== "<" && op !== "<=") fail(stmt, "for-loop condition must be `<` or `<=`");
  const inc = stmt.incrementor;
  const isPlusPlus =
    inc && (ts.isPostfixUnaryExpression(inc) || ts.isPrefixUnaryExpression(inc)) &&
    inc.operator === ts.SyntaxKind.PlusPlusToken &&
    ts.isIdentifier(inc.operand) && inc.operand.text === d.name.text;
  if (!isPlusPlus) fail(stmt, "for-loop incrementor must be `i++`");
  return { counter: d.name.text, from: d.initializer, to: cond.right, inclusive: op === "<=" };
}

/** Static type of an expression. */
function exprType(node, env, model, fn) {
  if (ts.isNumericLiteral(node)) return /^[0-9]+$/.test(node.text) ? "intlit" : "double";
  if (ts.isIdentifier(node)) {
    const v = env.get(node.text);
    if (v) return v.type;
    const c = model.constTypes[node.text];
    if (c) return c;
    fail(node, `unknown identifier '${node.text}'`);
  }
  if (ts.isParenthesizedExpression(node)) return exprType(node.expression, env, model, fn);
  if (ts.isPrefixUnaryExpression(node)) {
    if (node.operator !== ts.SyntaxKind.MinusToken) fail(node, "only unary minus is supported");
    return exprType(node.operand, env, model, fn);
  }
  if (ts.isPropertyAccessExpression(node)) {
    const objText = node.expression.getText();
    const member = node.name.text;
    if (objText === "Math") {
      if (member === "PI") return "double";
      fail(node, `unsupported Math member '${member}'`);
    }
    const objT = exprType(node.expression, env, model, fn);
    if (objT.startsWith("struct:")) {
      const iface = model.interfaces[objT.slice(7)];
      if (!iface.fields.includes(member)) fail(node, `'${member}' is not a field of ${objT}`);
      return "double";
    }
    fail(node, `unsupported member access on ${objT}`);
  }
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.getText();
    const a = exprType(node.left, env, model, fn);
    const b = exprType(node.right, env, model, fn);
    if (["+", "-", "*"].includes(op)) return combineNum(a, b, node);
    if (op === "/") { combineNum(a, b, node); return "double"; }
    if (["<", ">", "<=", ">=", "===", "!=="].includes(op)) { combineNum(a, b, node); return "bool"; }
    fail(node, `unsupported operator '${op}'`);
  }
  if (ts.isConditionalExpression(node)) {
    const c = exprType(node.condition, env, model, fn);
    if (c !== "bool") fail(node, "ternary condition must be a comparison");
    const a = exprType(node.whenTrue, env, model, fn);
    const b = exprType(node.whenFalse, env, model, fn);
    if (isNumeric(a) && isNumeric(b)) return combineNum(a, b, node);
    if (a !== b) fail(node, `ternary branches disagree (${a} vs ${b})`);
    return a;
  }
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    if (ts.isPropertyAccessExpression(callee) && callee.expression.getText() === "Math") {
      const m = callee.name.text;
      if (!MATH_FNS.has(m)) fail(node, `unsupported Math.${m}`);
      for (const a of node.arguments) {
        const t = exprType(a, env, model, fn);
        if (!isNumeric(t)) fail(a, `Math.${m} args must be numeric`);
      }
      return "double";
    }
    if (ts.isIdentifier(callee)) {
      const sig = model.fnSigs[callee.text] ?? fail(node, `call to unknown function '${callee.text}'`);
      if (node.arguments.length !== sig.params.length) fail(node, `arity mismatch calling ${callee.text}`);
      for (const a of node.arguments) exprType(a, env, model, fn);
      return sig.returnType;
    }
    fail(node, "unsupported call target");
  }
  if (ts.isNewExpression(node)) {
    if (node.expression.getText() !== "Float32Array" || node.arguments?.length !== 1) {
      fail(node, "only `new Float32Array(n)` is supported");
    }
    return "farray";
  }
  if (ts.isObjectLiteralExpression(node)) {
    const keys = node.properties.map((p) => p.name.getText()).sort();
    for (const [name, iface] of Object.entries(model.interfaces)) {
      if (JSON.stringify([...iface.fields].sort()) === JSON.stringify(keys)) {
        return (iface.kind === "bundle" ? "bundle:" : "struct:") + name;
      }
    }
    fail(node, "object literal does not match a declared interface shape");
  }
  if (ts.isElementAccessExpression(node)) fail(node, "Float32Array element READS are unsupported (write-only arrays)");
  fail(node, `unsupported expression (kind ${ts.SyntaxKind[node.kind]})`);
}

/* ============================== EMISSION ================================== */

const PREC = { "*": 4, "/": 4, "+": 3, "-": 3, "<": 2, ">": 2, "<=": 2, ">=": 2, "===": 2, "!==": 2 };

/** Shared emitter driver: walks the model and emits via a per-language backend. */
function emitModule(model, lang, { namespace, slug, sourcePath }) {
  const Name = pascal(slug);
  const used = new Set(); // intrinsics used (drives Kotlin imports)
  const isKt = lang === "kotlin";

  /** Format a numeric literal's source text for the target context. */
  const lit = (node, ctx) => {
    let text = node.text;
    if (ctx === "int") {
      if (!/^[0-9]+$/.test(text)) fail(node, "non-integer literal in int context");
      return text;
    }
    if (!text.includes(".") && !text.includes("e") && !text.includes("E")) text += ".0";
    if (ctx === "float") return isKt ? `${text}f` : text;
    return text;
  };

  /** Wrap an emitted double expression into an int/float conversion. */
  const conv = (code, simple, to) => {
    const open = simple ? code : `(${code})`;
    if (isKt) return `${open}.to${to === "int" ? "Int" : to === "float" ? "Float" : "Double"}()`;
    return `${to === "int" ? "Int" : to === "float" ? "Float" : "Double"}(${code})`;
  };

  const isSimple = (node) =>
    ts.isIdentifier(node) || ts.isPropertyAccessExpression(node) || ts.isCallExpression(node) ||
    ts.isParenthesizedExpression(node) || ts.isNumericLiteral(node);

  /**
   * Emit `node` in `ctx` ∈ 'double' | 'int' | 'float' | 'bool' | 'auto'.
   * 'auto' keeps the node's own type (structs, arrays, int-typed init, …).
   */
  function emit(node, ctx, fn, parentPrec = 0, rightSide = false) {
    const t = exprType(node, fn.env, model, fn);

    // Context coercions first (then re-emit the node in its natural type).
    if (ctx === "double" && (t === "int" || t === "intlit")) {
      if (ts.isNumericLiteral(node)) return lit(node, "double");
      if (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand)) {
        return `-${lit(node.operand, "double")}`;
      }
      return conv(emit(node, "auto", fn), isSimple(node), "double");
    }
    if (ctx === "int" && t === "double") {
      return conv(emit(node, "double", fn), isSimple(node), "int");
    }
    if (ctx === "float") {
      if (ts.isNumericLiteral(node)) return lit(node, "float");
      return conv(emit(node, "double", fn), isSimple(node), "float");
    }
    if (ts.isNumericLiteral(node)) return lit(node, ctx === "int" ? "int" : ctx === "auto" && t !== "double" ? "int" : "double");
    if (ts.isIdentifier(node)) {
      // Mutated params are shadowed by a local `var` of the same name.
      return node.text;
    }
    if (ts.isParenthesizedExpression(node)) return `(${emit(node.expression, ctx, fn)})`;
    if (ts.isPrefixUnaryExpression(node)) {
      const inner = emit(node.operand, ctx === "auto" && isNumeric(t) ? (t === "double" ? "double" : "int") : ctx, fn, 5);
      return `-${inner}`;
    }
    if (ts.isPropertyAccessExpression(node)) {
      if (node.expression.getText() === "Math" && node.name.text === "PI") {
        used.add("PI");
        return isKt ? "PI" : "Double.pi";
      }
      return `${emit(node.expression, "auto", fn, 5)}.${node.name.text}`;
    }
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.getText();
      const outOp = op === "===" ? "==" : op === "!==" ? "!=" : op;
      const prec = PREC[op];
      let operandCtx;
      if (op === "/") operandCtx = "double";
      else if (["+", "-", "*"].includes(op)) operandCtx = t === "double" ? "double" : "int";
      else {
        // comparison: compare in the operands' combined numeric type
        const ct = combineNum(
          exprType(node.left, fn.env, model, fn),
          exprType(node.right, fn.env, model, fn),
          node,
        );
        operandCtx = ct === "double" ? "double" : "int";
      }
      let l = emit(node.left, operandCtx, fn, prec, false);
      let r = emit(node.right, operandCtx, fn, prec, true);
      const wrap = (child, code, isRight) => {
        if (ts.isBinaryExpression(child)) {
          const cp = PREC[child.operatorToken.getText()];
          if (cp < prec || (cp === prec && isRight && (op === "-" || op === "/"))) return `(${code})`;
        }
        if (ts.isConditionalExpression(child)) return `(${code})`;
        return code;
      };
      return `${wrap(node.left, l, false)} ${outOp} ${wrap(node.right, r, true)}`;
    }
    if (ts.isConditionalExpression(node)) {
      const branchCtx = isNumeric(t) ? (t === "double" ? "double" : "int") : "auto";
      const c = emit(node.condition, "bool", fn);
      const a = emit(node.whenTrue, branchCtx, fn);
      const b = emit(node.whenFalse, branchCtx, fn);
      return isKt ? `(if (${c}) ${a} else ${b})` : `(${c} ? ${a} : ${b})`;
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isPropertyAccessExpression(callee) && callee.expression.getText() === "Math") {
        const m = callee.name.text;
        used.add(m);
        const args = node.arguments.map((a) => emit(a, "double", fn));
        if (m === "round") {
          // JS Math.round(x) == floor(x + 0.5) for finite x.
          return `floor(${args[0]} + 0.5)`;
        }
        if (m === "pow") {
          return isKt
            ? `${isSimple(node.arguments[0]) && !ts.isNumericLiteral(node.arguments[0]) ? args[0] : `(${args[0]})`}.pow(${args[1]})`
            : `pow(${args[0]}, ${args[1]})`;
        }
        if (m === "min" || m === "max") {
          return isKt ? `${m}Of(${args.join(", ")})` : `${m}(${args.join(", ")})`;
        }
        return `${m}(${args.join(", ")})`;
      }
      // local function call
      const sig = model.fnSigs[callee.text];
      const args = node.arguments.map((a, i) => {
        const p = sig.params[i];
        const pctx = p.type === "double" ? "double" : "auto";
        let code = emit(a, pctx, fn);
        if (!isKt && p.type === "farray" && sig.writtenArrays?.has(p.name)) code = `&${code}`; // inout
        return !isKt && sig.exported ? `${p.name}: ${code}` : code;
      });
      return `${callee.text}(${args.join(", ")})`;
    }
    if (ts.isNewExpression(node)) {
      const n = emit(node.arguments[0], "int", fn);
      return isKt ? `FloatArray(${n})` : `[Float](repeating: 0, count: ${n})`;
    }
    if (ts.isObjectLiteralExpression(node)) {
      const ifaceName = t.slice(t.indexOf(":") + 1);
      const iface = model.interfaces[ifaceName];
      const valueOf = (fieldName) => {
        const p = node.properties.find((pp) => pp.name.getText() === fieldName);
        if (ts.isShorthandPropertyAssignment(p)) return { node: p.name, shorthand: true };
        if (ts.isPropertyAssignment(p)) return { node: p.initializer, shorthand: false };
        fail(p, "unsupported object property");
      };
      if (iface.kind === "bundle") {
        const parts = iface.fields.map((f) => {
          const v = valueOf(f);
          const code = emit(v.node, "auto", fn);
          return isKt ? code : `${f}: ${code}`;
        });
        return isKt ? `${ifaceName}(${parts.join(", ")})` : `(${parts.join(", ")})`;
      }
      const parts = iface.fields.map((f) => {
        const code = emit(valueOf(f).node, "double", fn);
        return isKt ? code : `${f}: ${code}`;
      });
      return `${ifaceName}(${parts.join(", ")})`;
    }
    fail(node, "unsupported expression in emission");
  }

  /* ---------------- statements ---------------- */

  const lines = [];
  const push = (depth, s) => lines.push(`${"    ".repeat(depth)}${s}`);

  function emitStmt(stmt, depth, fn) {
    if (ts.isVariableStatement(stmt)) {
      const isConst = !!(stmt.declarationList.flags & ts.NodeFlags.Const);
      for (const d of stmt.declarationList.declarations) {
        const name = d.name.text;
        const v = fn.env.get(name);
        const ctx = v.type === "double" ? "double" : v.type === "int" ? "int" : "auto";
        const init = emit(d.initializer, ctx, fn);
        // Swift arrays are value types: a Float32Array local that gets written
        // (directly or via an inout call) must be `var`.
        const kw = isConst && !(!isKt && v.type === "farray") ? (isKt ? "val" : "let") : "var";
        push(depth, `${kw} ${name} = ${init}`);
      }
      return;
    }
    if (ts.isExpressionStatement(stmt)) {
      const e = stmt.expression;
      const op = e.operatorToken.getText();
      if (ts.isIdentifier(e.left)) {
        const v = fn.env.get(e.left.text);
        const ctx = v.type === "double" ? "double" : "int";
        push(depth, `${e.left.text} ${op} ${emit(e.right, ctx, fn)}`);
        return;
      }
      // farray element write
      const arr = emit(e.left.expression, "auto", fn);
      const idx = emit(e.left.argumentExpression, "int", fn);
      push(depth, `${arr}[${idx}] ${op} ${emit(e.right, "float", fn)}`);
      return;
    }
    if (ts.isIfStatement(stmt)) {
      push(depth, `if (${emit(stmt.expression, "bool", fn)}) {`);
      emitBody(stmt.thenStatement, depth + 1, fn);
      if (stmt.elseStatement) {
        push(depth, `} else {`);
        emitBody(stmt.elseStatement, depth + 1, fn);
      }
      push(depth, `}`);
      return;
    }
    if (ts.isForStatement(stmt)) {
      const { counter, from, to, inclusive } = forParts(stmt);
      const a = emit(from, "int", fn);
      const b = emit(to, "int", fn);
      // Swift warns on an unused loop counter — bind `_` when the body never reads it.
      const usedInBody = new RegExp(`\\b${counter}\\b`).test(stmt.statement.getText());
      const swiftCounter = usedInBody ? counter : "_";
      if (isKt) push(depth, `for (${counter} in ${a} ${inclusive ? ".." : "until"} ${b}) {`);
      else push(depth, `for ${swiftCounter} in ${a} ${inclusive ? "..." : "..<"} ${b} {`);
      emitBody(stmt.statement, depth + 1, fn);
      push(depth, `}`);
      return;
    }
    if (ts.isReturnStatement(stmt)) {
      if (!stmt.expression) { push(depth, "return"); return; }
      const ctx = fn.returnType === "double" ? "double" : "auto";
      push(depth, `return ${emit(stmt.expression, ctx, fn)}`);
      return;
    }
    if (ts.isBreakStatement(stmt)) { push(depth, "break"); return; }
    if (ts.isContinueStatement(stmt)) { push(depth, "continue"); return; }
    fail(stmt, "unsupported statement in emission");
  }
  function emitBody(s, depth, fn) {
    if (ts.isBlock(s)) { for (const st of s.statements) emitStmt(st, depth, fn); }
    else emitStmt(s, depth, fn);
  }

  /* ---------------- declarations ---------------- */

  const typeName = (t) => {
    if (t === "double") return "Double";
    if (t === "farray") return isKt ? "FloatArray" : "[Float]";
    if (t.startsWith("struct:")) return t.slice(7);
    if (t.startsWith("bundle:")) {
      if (isKt) return t.slice(7);
      const iface = model.interfaces[t.slice(7)];
      return `(${iface.fields.map((f) => `${f}: [Float]`).join(", ")})`;
    }
    throw new Error(`logic: no type name for ${t}`);
  };

  // consts
  for (const c of consts(model)) {
    const init = emitConstInit(c.init, c.type, model, isKt);
    if (isKt) push(0, `${c.exported ? "" : "private "}const val ${c.name} = ${init}`);
    else push(0, `${c.exported ? "public " : "private "}let ${c.name} = ${init}`);
  }
  if (model.consts.length) push(0, "");

  // struct interfaces (bundles too, on Kotlin)
  for (const [name, iface] of Object.entries(model.interfaces)) {
    if (iface.kind === "struct") {
      if (isKt) push(0, `private class ${name}(val ${iface.fields.join(": Double, val ")}: Double)`);
      else push(0, `private struct ${name} { ${iface.fields.map((f) => `var ${f}: Double`).join("; ")} }`);
      push(0, "");
    } else if (isKt) {
      push(0, `/** The precomputed frame arrays the shader consumes (${iface.fields.join(" / ")}). */`);
      push(0, `class ${name}(${iface.fields.map((f) => `val ${f}: FloatArray`).join(", ")})`);
      push(0, "");
    }
  }

  // functions
  for (const fn of model.functions) {
    const sig = fn.params.map((p) => {
      const mutated = fn.mutatedParams.has(p.name);
      const internal = mutated ? `${p.name}0` : p.name;
      if (isKt) return `${internal}: ${typeName(p.type)}`;
      const label = fn.exported ? p.name : "_";
      const ty = p.type === "farray" && fn.writtenArrays.has(p.name) ? "inout [Float]" : typeName(p.type);
      return `${label === internal ? internal : `${label} ${internal}`}: ${ty}`;
    });
    const ret = fn.returnType === "void" ? "" : isKt ? `: ${typeName(fn.returnType)}` : ` -> ${typeName(fn.returnType)}`;
    const vis = fn.exported ? (isKt ? "" : "public ") : "private ";
    if (isKt) push(0, `${vis}fun ${fn.name}(${sig.join(", ")})${ret} {`);
    else push(0, `${vis}func ${fn.name}(${sig.join(", ")})${ret} {`);
    for (const m of fn.mutatedParams) push(1, `var ${m} = ${m}0`);
    emitBody(fn.body, 1, fn);
    push(0, `}`);
    push(0, "");
  }

  /* ---------------- header ---------------- */

  const header = [];
  const note = [
    `// @generated by @dopamine/build from ${sourcePath} — do not edit.`,
    `//`,
    `// ${Name}'s CPU-precomputed per-frame geometry, TRANSPILED from the single web`,
    `// source by tools/dopamine/src/logic.mjs (the x-build.logic block). Numeric`,
    `// semantics mirror JS: doubles end-to-end, float32 narrowing only at the`,
    `// array writes, identical operation order. Gated byte-for-byte by`,
    `// tools/dopamine/test/logic.test.mjs and numerically by the committed`,
    `// web-dumped parity fixture (pure-JVM JUnit + XCTest replays).`,
  ];
  if (isKt) {
    header.push(...note, "");
    header.push(`package ${namespace}`, "");
    const imports = [...new Set([...used].map((u) => KOTLIN_MATH_IMPORTS[u]).filter(Boolean))].sort();
    for (const imp of imports) header.push(`import ${imp}`);
    if (imports.length) header.push("");
  } else {
    header.push(...note, "");
    header.push("import Foundation", "");
  }

  return `${[...header, ...lines].join("\n").replace(/\n+$/, "")}\n`;
}

/** Top-level consts in source order (helper so emission reads cleanly). */
function consts(model) {
  return model.consts;
}

/** Emit a top-level const initializer (integer arithmetic kept native-int). */
function emitConstInit(node, type, model, isKt) {
  if (ts.isNumericLiteral(node)) {
    if (type === "int") return node.text;
    return node.text.includes(".") ? node.text : `${node.text}.0`;
  }
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isBinaryExpression(node)) {
    return `${emitConstInit(node.left, type, model, isKt)} ${node.operatorToken.getText()} ${emitConstInit(node.right, type, model, isKt)}`;
  }
  if (ts.isParenthesizedExpression(node)) return `(${emitConstInit(node.expression, type, model, isKt)})`;
  fail(node, "unsupported const initializer");
}

/* ============================ PUBLIC API ================================== */

/** Transpile a logic module → { swift, kotlin } sources. */
export function transpileLogic({ slug, source, sourcePath, namespace }) {
  const model = parseLogicModule(source, sourcePath);
  return {
    model,
    swift: emitModule(model, "swift", { slug, sourcePath, namespace }),
    kotlin: emitModule(model, "kotlin", { slug, sourcePath, namespace }),
  };
}

/**
 * The generated pure-JVM JUnit parity test: replays the committed fixture grid
 * (dumped from the web logic — ground truth) against the GENERATED Kotlin and
 * asserts every output float. Synced into dopamine-core's `testGenerated` test
 * source set, so the JVM CI job (no Android SDK) COMPILES the generated Kotlin
 * and runs the grid.
 */
export function emitKotlinLogicParityTest(model, slug, namespace) {
  const Name = pascal(slug);
  const entry = model.entry;
  const bundle = model.interfaces[entry.returnType.slice(7)];
  const args = entry.params
    .map((p) => `                ${p.name} = c["${p.name}"]!!.asNumber!!,`)
    .join("\n");
  const checks = bundle.fields
    .map((f) => `            checkArray("${f}[$caseIdx]", c["${f}"]!!.asArray!!, out.${f})`)
    .join("\n");
  return `// @generated by @dopamine/build from effects/${slug} — do not edit.
//
// PURE-JVM numeric parity gate for the GENERATED ${Name}Renderer.kt: replays the
// committed fixture grid (dumped from the web ${slug}-logic.ts — ground truth)
// and asserts every float of every precomputed array matches the web output.
// Lives in dopamine-core's testGenerated source set (synced by \`dopamine build\`)
// so the plain-JVM CI job compiles the generated Kotlin with NO Android SDK.

package ${namespace}

import ai.dopamine.core.JsonValue
import ai.dopamine.core.parseOrderedJson
import kotlin.math.abs
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ${Name}LogicParityTest {

    private fun resource(name: String): String {
        val stream = javaClass.classLoader.getResourceAsStream(name)
            ?: error("missing test resource: $name")
        return stream.bufferedReader(Charsets.UTF_8).use { it.readText() }
    }

    /** Doubles end-to-end; only libm transcendentals may differ by ULPs across
     *  platforms, far below the float32 quantum the arrays store. */
    private fun checkArray(label: String, expected: List<JsonValue>, got: FloatArray) {
        assertEquals("$label size", expected.size, got.size)
        for (i in expected.indices) {
            val e = expected[i].asNumber!!
            val g = got[i].toDouble()
            assertEquals("$label[$i]", e, g, maxOf(1e-6, abs(e) * 1e-6))
        }
    }

    @Test
    fun logicParityAcrossGrid() {
        val fixture = parseOrderedJson(resource("${slug}-logic-parity.json"))
        val cases = fixture["cases"]?.asArray ?: error("fixture missing cases")
        assertTrue("expected a non-empty grid", cases.isNotEmpty())
        for ((caseIdx, c) in cases.withIndex()) {
            val out = ${entry.name}(
${args}
            )
${checks}
        }
    }
}
`;
}

/**
 * The generated XCTest parity suite for the dist SwiftPM package (Linux-runnable:
 * the generated renderer is pure Swift): same fixture, same grid, same epsilon.
 */
export function emitSwiftLogicParityTests(model, slug, module) {
  const Name = pascal(slug);
  const entry = model.entry;
  const bundle = model.interfaces[entry.returnType.slice(7)];
  const args = entry.params.map((p) => `${p.name}: num("${p.name}")`).join(", ");
  const checks = bundle.fields
    .map((f) => `            check("${f}[\\(caseIdx)]", c["${f}"] as! [NSNumber], out.${f})`)
    .join("\n");
  return `// @generated by @dopamine/build from effects/${slug} — do not edit.
//
// Numeric parity gate for the GENERATED ${Name}Renderer.swift: replays the
// committed fixture grid (dumped from the web ${slug}-logic.ts — ground truth)
// and asserts every float of every precomputed array. The generated renderer is
// PURE Swift (no Metal), so this runs on Linux too: \`swift test\` in the package.

import XCTest
import Foundation
import ${module}

final class ${Name}LogicParityTests: XCTestCase {

    /// Doubles end-to-end; only libm transcendentals may differ by ULPs across
    /// platforms, far below the float32 quantum the arrays store.
    private func check(_ label: String, _ expected: [NSNumber], _ got: [Float]) {
        XCTAssertEqual(expected.count, got.count, "\\(label) size")
        for (i, e) in expected.enumerated() {
            let want = e.doubleValue
            let have = Double(got[i])
            XCTAssertEqual(want, have, accuracy: max(1e-6, abs(want) * 1e-6), "\\(label)[\\(i)]")
        }
    }

    func testLogicParityAcrossGrid() throws {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "${slug}-logic-parity", withExtension: "json"))
        let data = try Data(contentsOf: url)
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let cases = try XCTUnwrap(root["cases"] as? [[String: Any]])
        XCTAssertFalse(cases.isEmpty, "expected a non-empty grid")
        for (caseIdx, c) in cases.enumerated() {
            func num(_ key: String) -> Double { (c[key] as! NSNumber).doubleValue }
            let out = ${entry.name}(${args})
${checks}
        }
    }
}
`;
}

/**
 * Load + transpile an effect's `x-build.logic` block (or null if absent):
 * reads the web source + the committed parity fixture, returns everything the
 * platform emitters and the sync step need.
 */
export async function loadLogic(eff) {
  const cfg = eff.doc["x-build"]?.logic;
  if (!cfg) return null;
  if (!cfg.src) throw new Error(`logic: ${eff.slug} x-build.logic needs a 'src'`);
  const namespace = eff.doc["x-build"]?.android?.namespace ?? `ai.dopamine.effect.${eff.slug}`;
  const source = await readFile(join(eff.dir, cfg.src), "utf8");
  const sourcePath = `effects/${eff.slug}/${cfg.src}`;
  const { model, swift, kotlin } = transpileLogic({ slug: eff.slug, source, sourcePath, namespace });
  let fixture = null;
  if (cfg.parityFixture) {
    fixture = await readFile(join(eff.dir, cfg.parityFixture), "utf8");
  }
  return { cfg, model, swift, kotlin, fixture, namespace, slug: eff.slug };
}
