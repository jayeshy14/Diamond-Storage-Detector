import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/reporter/markdown.js";
import type { Finding } from "../src/detector/types.js";

const EMPTY_FINDING_BASE: Pick<Finding, "facets" | "locations" | "detail"> = {
  facets: [],
  locations: [],
  detail: undefined,
};

describe("renderMarkdown", () => {
  it("renders a clean message when there are no findings", () => {
    const out = renderMarkdown([], 12);
    expect(out).toContain("✅");
    expect(out).toContain("12 contract(s)");
  });

  it("groups findings by kind with severity-tagged collapsible sections", () => {
    const findings: Finding[] = [
      {
        ...EMPTY_FINDING_BASE,
        kind: "diamond-storage-namespace",
        severity: "error",
        slot: "0x1111",
        message: "ns.shared collides",
        facets: ["LibA", "LibB"],
        locations: [{ file: "src/LibA.sol" }, { file: "src/LibB.sol" }],
      },
      {
        ...EMPTY_FINDING_BASE,
        kind: "inheritance-overlap",
        severity: "warn",
        slot: "0x0000",
        message: "slot 0 overlap",
        facets: ["FacetX", "FacetY"],
        locations: [{ file: "src/X.sol" }, { file: "src/Y.sol" }],
      },
      {
        ...EMPTY_FINDING_BASE,
        kind: "inline-assembly-slot",
        severity: "info",
        slot: "0xdead",
        message: "sstore literal",
        facets: ["LibZ"],
        locations: [{ file: "src/LibZ.sol" }],
      },
    ];
    const out = renderMarkdown(findings, 7);
    expect(out).toMatchSnapshot();
  });

  it("opens the error section by default but keeps warn/info collapsed", () => {
    const findings: Finding[] = [
      {
        ...EMPTY_FINDING_BASE,
        kind: "diamond-storage-namespace",
        severity: "error",
        slot: "0x1",
        message: "x",
        facets: ["A"],
        locations: [],
      },
      {
        ...EMPTY_FINDING_BASE,
        kind: "inline-assembly-slot",
        severity: "info",
        slot: "0x2",
        message: "y",
        facets: ["B"],
        locations: [],
      },
    ];
    const out = renderMarkdown(findings, 2);
    const errorSection = out.split("</details>")[0]!;
    const infoSection = out.split("</details>")[1]!;
    expect(errorSection).toContain("<details open>");
    expect(infoSection).toContain("<details>");
    expect(infoSection).not.toContain("<details open>");
  });

  it("escapes pipes in messages so the section body stays valid markdown", () => {
    const findings: Finding[] = [
      {
        ...EMPTY_FINDING_BASE,
        kind: "appstorage-fingerprint",
        severity: "error",
        slot: "n/a",
        message: "field|with|pipes",
        facets: ["A"],
        locations: [],
      },
    ];
    const out = renderMarkdown(findings, 1);
    expect(out).toContain("field\\|with\\|pipes");
  });
});
