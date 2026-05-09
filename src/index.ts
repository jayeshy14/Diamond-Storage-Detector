export { detect } from "./detector/index.js";
export { loadFoundryArtifacts } from "./detector/parseArtifacts.js";
export { erc7201Slot, parseErc7201Annotation } from "./lib/eip7201.js";
export type {
  Analyzer,
  AnalyzerContext,
  FacetArtifact,
  Finding,
  FindingKind,
  Severity,
} from "./detector/types.js";
