export type Severity = "info" | "warn" | "error";

export type FindingKind =
  | "diamond-storage-namespace"
  | "appstorage-fingerprint"
  | "erc7201-namespace"
  | "inline-assembly-slot"
  | "inheritance-overlap"
  | "mapping-overlap";

export interface SourceLocation {
  file: string;
  line?: number;
  column?: number;
}

export interface Finding {
  kind: FindingKind;
  severity: Severity;
  slot: string;
  message: string;
  facets: string[];
  locations: SourceLocation[];
  detail?: Record<string, unknown>;
}

export interface StorageLayoutSlot {
  astId: number;
  contract: string;
  label: string;
  offset: number;
  slot: string;
  type: string;
}

export interface StorageLayout {
  storage: StorageLayoutSlot[];
  types: Record<
    string,
    {
      encoding: string;
      label: string;
      numberOfBytes: string;
      members?: StorageLayoutSlot[];
      key?: string;
      value?: string;
      base?: string;
    }
  > | null;
}

export interface FacetArtifact {
  contractName: string;
  sourcePath: string;
  artifactPath: string;
  storageLayout: StorageLayout | null;
  ast: unknown;
  bytecodeHash?: string;
}

export interface AnalyzerContext {
  artifacts: FacetArtifact[];
  rawSources: Map<string, string>;
  isFacet?: (artifact: FacetArtifact) => boolean;
}

export interface Analyzer {
  name: string;
  run: (ctx: AnalyzerContext) => Promise<Finding[]> | Finding[];
}
