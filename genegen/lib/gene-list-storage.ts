export type SavedGeneList = {
  name: string;
  genes: string[];
  updatedAt: string;
};

const STORAGE_KEY = 'geno-intelligence-ontology-gene-lists';

export function getSavedGeneLists(): Record<string, SavedGeneList> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, SavedGeneList>) : {};
  } catch {
    return {};
  }
}

export function saveGeneList(name: string, genes: string[]): void {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Enter a name for your gene list');
  if (genes.length === 0) throw new Error('Select at least one gene before saving');
  const all = getSavedGeneLists();
  all[trimmed] = {
    name: trimmed,
    genes: [...genes],
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function getSavedGeneListNames(): string[] {
  return Object.keys(getSavedGeneLists()).sort((a, b) => a.localeCompare(b));
}

export function loadGeneListByName(name: string): SavedGeneList | null {
  return getSavedGeneLists()[name] ?? null;
}
