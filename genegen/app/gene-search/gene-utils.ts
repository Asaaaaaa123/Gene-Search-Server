export interface GeneSymbol {
  symbol: string;
  name: string;
  tissue: string;
  expression: number;
}

/**
 * Find a gene by symbol (case-insensitive)
 */
export function findGeneBySymbol(
  geneSymbols: GeneSymbol[],
  searchSymbol: string
): GeneSymbol | null {
  if (!searchSymbol) {
    return null;
  }
  const searchLower = searchSymbol.toLowerCase();
  return geneSymbols.find(g => g.symbol.toLowerCase() === searchLower) || null;
}
