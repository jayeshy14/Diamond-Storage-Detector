import type { Analyzer } from "../types.js";
import { diamondStorageAnalyzer } from "./diamondStorage.js";
import { erc7201Analyzer } from "./erc7201.js";
import { appStorageAnalyzer } from "./appStorage.js";
import { inlineAssemblyAnalyzer } from "./inlineAssembly.js";
import { inheritanceAnalyzer } from "./inheritance.js";

export const defaultAnalyzers: Analyzer[] = [
  diamondStorageAnalyzer,
  erc7201Analyzer,
  appStorageAnalyzer,
  inlineAssemblyAnalyzer,
  inheritanceAnalyzer,
];

export {
  diamondStorageAnalyzer,
  erc7201Analyzer,
  appStorageAnalyzer,
  inlineAssemblyAnalyzer,
  inheritanceAnalyzer,
};
