/** One gene symbol per line (matches ontology analyze API). */
export function parseGeneListText(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const sym = line.trim();
    if (!sym || sym.startsWith('#') || seen.has(sym)) continue;
    seen.add(sym);
    out.push(sym);
  }
  return out;
}

export function genesToTxtFile(genes: string[], filename: string): File {
  const body = genes.join('\n') + (genes.length ? '\n' : '');
  return new File([body], filename, { type: 'text/plain' });
}

export async function fetchGeneListFromUrl(url: string): Promise<string[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load gene list (${res.status})`);
  return parseGeneListText(await res.text());
}
