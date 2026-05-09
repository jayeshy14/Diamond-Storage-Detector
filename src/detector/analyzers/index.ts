import type { Analyzer } from "../types.js";
import { diamondStorageAnalyzer } from "./diamondStorage.js";
import { erc7201Analyzer } from "./erc7201.js";

export const defaultAnalyzers: Analyzer[] = [diamondStorageAnalyzer, erc7201Analyzer];

export { diamondStorageAnalyzer, erc7201Analyzer };
