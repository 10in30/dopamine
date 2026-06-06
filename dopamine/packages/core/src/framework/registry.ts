/**
 * Effect registry — the lookup table the runtime uses to find an effect by name.
 *
 * Effects self-register on import (see `effects/*.ts`), which keeps the registry
 * tree-shakeable: if you never import an effect, it never lands in the bundle
 * *or* the registry. The public `play({ effect })` / element / React surfaces
 * all route through here.
 */

import type { EffectFactory } from "./effect.js";

const effects = new Map<string, EffectFactory>();

/**
 * Register (or override) an effect. Returns the factory so registration can be
 * the module's export pattern:
 *
 * ```ts
 * export default registerEffect({
 *   name: "confetti",
 *   resolve(feeling, mood) { ... },
 *   create(params, ctx) { ... },
 * });
 * ```
 */
export function registerEffect<P>(factory: EffectFactory<P>): EffectFactory<P> {
  effects.set(factory.name, factory as EffectFactory);
  return factory;
}

/** Look up an effect by name, or `undefined` if it hasn't been registered. */
export function getEffect(name: string): EffectFactory | undefined {
  return effects.get(name);
}

/** Whether an effect name is registered. */
export function hasEffect(name: string): boolean {
  return effects.has(name);
}

/** Names of all registered effects. */
export function effectNames(): string[] {
  return [...effects.keys()];
}
