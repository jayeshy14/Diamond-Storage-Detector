import { describe, expect, it } from "vitest";
import { renderTerminal } from "../src/reporter/terminal.js";
import type { Finding } from "../src/detector/types.js";

// Strip ANSI so assertions hold regardless of FORCE_COLOR / TTY state.
// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string) => s.replace(/\[[0-9;]*m/g, "");

const SOURCE = 'pragma solidity 0.8.24;\n    bytes32 constant S = 0x1;\n';
// Line 2 (`    bytes32 constant S = 0x1;`): "bytes32" begins at byte offset 28.
const SRC_SPAN = "28:25:0";

function collisionFinding(): Finding {
  return {
    kind: "diamond-storage-namespace",
    severity: "error",
    slot: "0x340080245a7d3e67835fb5055646777827d09fc7212fda4d8d724367e1215700",
    message: "distinct facets share the same slot.",
    facets: ["LibA", "LibB"],
    locations: [{ file: "src/A.sol", src: SRC_SPAN }],
  };
}

describe("renderTerminal", () => {
  it("reports a clean scan with the artifact count", () => {
    const out = stripAnsi(renderTerminal([], 3, new Map()));
    expect(out).toContain("no storage collisions detected");
    expect(out).toContain("3 artifacts scanned");
  });

  it("renders a rustc-style code frame with file:line:col, the source line, and a caret", () => {
    const sources = new Map([["src/A.sol", SOURCE]]);
    const out = stripAnsi(renderTerminal([collisionFinding()], 4, sources));
    expect(out).toContain("error[diamond-storage-namespace]:");
    expect(out).toContain("src/A.sol:2:5"); // line 2, column 5 (after 4-space indent)
    expect(out).toContain("bytes32 constant S = 0x1;"); // the offending source line
    expect(out).toMatch(/─{5,}/); // caret underline
    expect(out).toContain("= facets:");
    expect(out).toContain("LibA");
    expect(out).toContain("= help:");
    expect(out).toContain("✖ 1 error");
  });

  it("degrades to a file location when no source span is available", () => {
    const finding = { ...collisionFinding(), locations: [{ file: "src/A.sol", line: 9 }] };
    const out = stripAnsi(renderTerminal([finding], 1, new Map()));
    expect(out).toContain("src/A.sol:9");
    expect(out).not.toMatch(/─{5,}/); // no frame without source text
  });

  it("singularizes the artifact count", () => {
    const out = stripAnsi(renderTerminal([], 1, new Map()));
    expect(out).toContain("1 artifact scanned");
    expect(out).not.toContain("1 artifacts scanned");
  });
});
