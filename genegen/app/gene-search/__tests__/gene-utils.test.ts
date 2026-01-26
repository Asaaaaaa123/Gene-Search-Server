import { findGeneBySymbol, type GeneSymbol } from '../gene-utils';

describe('findGeneBySymbol', () => {
  const mockGeneSymbols: GeneSymbol[] = [
    { symbol: 'Ywhaz', name: 'Tyrosine 3-monooxygenase', tissue: 'Cortex', expression: 2.5 },
    { symbol: 'Gapdh', name: 'Glyceraldehyde-3-phosphate dehydrogenase', tissue: 'Liver', expression: 5.0 },
    { symbol: 'Actb', name: 'Actin beta', tissue: 'Muscle', expression: 3.2 },
  ];

  it('finds gene with exact case match', () => {
    const result = findGeneBySymbol(mockGeneSymbols, 'Ywhaz');
    expect(result).not.toBeNull();
    expect(result?.symbol).toBe('Ywhaz');
  });

  it('finds gene with different case (uppercase search)', () => {
    const result = findGeneBySymbol(mockGeneSymbols, 'YWHAZ');
    expect(result).not.toBeNull();
    expect(result?.symbol).toBe('Ywhaz');
    expect(result?.tissue).toBe('Cortex');
  });

  it('finds gene with different case (lowercase search)', () => {
    const result = findGeneBySymbol(mockGeneSymbols, 'ywhaz');
    expect(result).not.toBeNull();
    expect(result?.symbol).toBe('Ywhaz');
  });

  it('finds gene with mixed case search', () => {
    const result = findGeneBySymbol(mockGeneSymbols, 'YwHaZ');
    expect(result).not.toBeNull();
    expect(result?.symbol).toBe('Ywhaz');
  });

  it('returns null for non-existent gene', () => {
    const result = findGeneBySymbol(mockGeneSymbols, 'NOTFOUND');
    expect(result).toBeNull();
  });

  it('returns null for empty search term', () => {
    const result = findGeneBySymbol(mockGeneSymbols, '');
    expect(result).toBeNull();
  });

  it('handles empty gene list', () => {
    const result = findGeneBySymbol([], 'YWHAZ');
    expect(result).toBeNull();
  });
});
