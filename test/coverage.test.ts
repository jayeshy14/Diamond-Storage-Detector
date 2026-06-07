import { describe, expect, it } from "vitest";
import { assessAstCoverage, decideCoverageAction } from "../src/detector/coverage.js";

const withAst = { ast: { nodeType: "SourceUnit" } };
const noAst = { ast: null };

describe("assessAstCoverage", () => {
  it("empty when there are no artifacts", () => {
    expect(assessAstCoverage([])).toBe("empty");
  });
  it("none when no artifact has an AST", () => {
    expect(assessAstCoverage([noAst, noAst])).toBe("none");
  });
  it("partial when some artifacts lack an AST", () => {
    expect(assessAstCoverage([withAst, noAst])).toBe("partial");
  });
  it("full when every artifact has an AST", () => {
    expect(assessAstCoverage([withAst, withAst])).toBe("full");
  });
});

describe("decideCoverageAction", () => {
  it("FAILS CLOSED with exit 2 when no artifact has an AST", () => {
    const d = decideCoverageAction([noAst, noAst]);
    expect(d.level).toBe("error");
    expect(d.exitCode).toBe(2);
    expect(d.message).toMatch(/no AST found/);
    expect(d.message).toMatch(/Failing closed/);
  });

  it("downgrades to a warning (no exit override) under --allow-missing-ast", () => {
    const d = decideCoverageAction([noAst, noAst], { allowMissingAst: true });
    expect(d.level).toBe("warn");
    expect(d.exitCode).toBeUndefined();
    expect(d.message).toMatch(/^warning:/);
  });

  it("warns but does not fail on partial coverage", () => {
    const d = decideCoverageAction([withAst, noAst]);
    expect(d.level).toBe("warn");
    expect(d.exitCode).toBeUndefined();
    expect(d.message).toMatch(/1 of 2 artifact/);
  });

  it("is silent on full coverage", () => {
    const d = decideCoverageAction([withAst, withAst]);
    expect(d.level).toBe("ok");
    expect(d.message).toBeUndefined();
    expect(d.exitCode).toBeUndefined();
  });

  it("is silent when there are no artifacts at all", () => {
    const d = decideCoverageAction([]);
    expect(d.level).toBe("ok");
    expect(d.exitCode).toBeUndefined();
  });
});
