import { describe, expect, it } from "vitest";
import { compositeLightFragment } from "../src/framework/pass-common.js";

// The backdrop-aware compositing path rewrites a light fragment's opaque emit
// into premultiplied light (alpha = brightness) so it composites source-over and
// stays visible on any surface — white included. These pin the rewrite contract
// so it can't drift from the Android build's equivalent emit swap.
describe("compositeLightFragment", () => {
  const main = (emit: string): string =>
    `#version 300 es\nprecision highp float;\nout vec4 fragColor;\nvoid main() {\n  vec3 col = vec3(1.0);\n  ${emit}\n}\n`;

  it("swaps `vec4(col, 1.0)` for `dopLightOut(col)` and injects the helper", () => {
    const out = compositeLightFragment(main("fragColor = vec4(col, 1.0);"));
    expect(out).toContain("fragColor = dopLightOut(col);");
    expect(out).not.toContain("fragColor = vec4(col, 1.0);");
    expect(out).toContain("vec4 dopLightOut(vec3 col){"); // helper injected before main
    expect(out.indexOf("dopLightOut(vec3")).toBeLessThan(out.indexOf("void main("));
  });

  it("swaps the `vec4(max(col, 0.0), 1.0)` emit form too", () => {
    const out = compositeLightFragment(main("fragColor = vec4(max(col, 0.0), 1.0);"));
    expect(out).toContain("fragColor = dopLightOut(col);");
    expect(out).toContain("vec4 dopLightOut(vec3 col){");
  });

  it("rewrites the LIGHT emit even when a shadow branch's opaque emit comes first", () => {
    // Mirrors the hybrid shaders (comic/confetti/heartburst): an early shadow
    // branch emits opaque + returns, then the real light emit. The light pass
    // runs with uShadow == 0, so the dead branch is harmless; what matters is
    // the live light emit becomes premultiplied.
    const frag =
      "#version 300 es\nout vec4 fragColor;\nvoid main() {\n" +
      "  if (uShadow > 0.5) { float dark = 0.5; fragColor = vec4(vec3(1.0 - dark), 1.0); return; }\n" +
      "  vec3 col = vec3(0.5);\n  fragColor = vec4(col, 1.0);\n}\n";
    const out = compositeLightFragment(frag);
    expect(out).toContain("fragColor = dopLightOut(col);");
    // The non-\\w+ shadow-branch emit (`vec3(1.0 - dark)`) is left intact.
    expect(out).toContain("fragColor = vec4(vec3(1.0 - dark), 1.0);");
  });

  it("leaves an already-premultiplied emit untouched (no helper injected)", () => {
    const frag = main("fragColor = vec4(col, max(col.r, max(col.g, col.b)));");
    const out = compositeLightFragment(frag);
    expect(out).toBe(frag);
    expect(out).not.toContain("dopLightOut");
  });

  it("is stable (same input → same output, served from cache)", () => {
    const frag = main("fragColor = vec4(col, 1.0);");
    expect(compositeLightFragment(frag)).toBe(compositeLightFragment(frag));
  });
});
