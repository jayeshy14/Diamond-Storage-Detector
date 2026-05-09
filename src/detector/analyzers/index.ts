import type { Analyzer } from "../types.js";
import { diamondStorageAnalyzer } from "./diamondStorage.js";

export const defaultAnalyzers: Analyzer[] = [diamondStorageAnalyzer];

export { diamondStorageAnalyzer };
