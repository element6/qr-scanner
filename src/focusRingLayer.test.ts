/**
 * Failure 1 — the focus ring must not fade in through an under-contrast colour.
 *
 * The defect was a *cascade layer* defect, not a colour one: an identical
 * `:focus-visible` rule in `@layer base` loses to Tailwind's `.transition`
 * utility, because `utilities` is declared last (`@layer theme, base,
 * components, utilities`). The utility lists `outline-color` in its
 * `transition-property`, so the ring animated up from 2.514:1 — under the 3:1
 * non-text floor — before settling at its designed contrast.
 *
 * jsdom does not implement `@layer` cascade, so the assertions below are on the
 * authored stylesheet's structure: the rule that outranks `.transition` has to
 * be declared in `utilities`, and it has to name every interactive property the
 * `transition` utility animates except `outline-color`. The compiled-CSS half of
 * this claim is checked against `docs/assets/*.css` (rule offset after
 * `.transition{`, same layer) rather than here.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// `import.meta.url` is an http URL under jsdom, so resolve from the project
// root instead: vitest runs with the repo root as cwd.
const css = readFileSync(resolve(process.cwd(), "public/style.css"), "utf8");

/**
 * Comments mention the very properties under test (the rationale quotes
 * `transition-property` and `!important`), so every assertion below reads
 * comment-free source. Brace counting must therefore run on the comment-free
 * text too, or a `{` inside a comment would unbalance the walk.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

const declarations = stripComments(css);

/** Body of the first top-level `@layer <name> { … }` block, or null. */
function layerBody(source: string, name: string): string | null {
  const start = source.indexOf(`@layer ${name} {`);
  if (start === -1) return null;
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

const utilities = layerBody(declarations, "utilities");
const base = layerBody(declarations, "base");

/** The `transition-property` list from the given rule body. */
function transitionList(body: string): string[] {
  const match = /transition-property:\s*([^;]+);/.exec(body);
  if (!match) throw new Error("no transition-property in rule");
  return match[1].split(",").map((part) => part.trim());
}

describe("focus ring lives in the utilities layer", () => {
  it("declares a focus-visible rule inside @layer utilities", () => {
    expect(utilities).not.toBeNull();
    expect(utilities).toContain(":focus-visible");
    expect(utilities).toContain("outline: 2px solid #007a55");
    expect(utilities).toContain("outline-offset: 2px");
  });

  it("no longer declares the focus-visible rule in @layer base", () => {
    // The base layer must not carry a competing rule: it can only ever lose to
    // the utility, and a second copy is how the two drifted apart before.
    expect(base === null || !base.includes(":focus-visible")).toBe(true);
  });

  it("drops outline-color from the transition list that the ring uses", () => {
    const scope = utilities ?? "";
    const list = transitionList(scope);
    expect(list).not.toContain("outline-color");
    // Hover/press feedback must keep animating: the fix may not freeze the
    // whole transition, so the colour/shadow/transform properties stay listed.
    for (const kept of [
      "color",
      "background-color",
      "border-color",
      "box-shadow",
      "transform",
      "opacity",
    ]) {
      expect(list).toContain(kept);
    }
  });

  it("keeps the inverted variant for filled green controls", () => {
    const scope = utilities ?? "";
    expect(scope).toContain('[class~="bg-emerald-700"]:focus-visible');
    expect(scope).toContain("outline-color: #ffffff");
    expect(scope).toContain("outline-offset: -4px");
  });

  it("needs no !important to win", () => {
    expect(utilities ?? "").not.toContain("!important");
  });
});
