const STORAGE_KEY_PREFIX = "geneSearch_v1_customTheme::";

export type StoredThemeOption = {
  id: string;
  name: string;
  description: string;
  category: string;
  keywords?: string[];
  backendThemeName?: string;
};

export type StoredCustomThemePreferences = {
  customThemes: StoredThemeOption[];
  themeKeywordOverrides: Record<string, string[]>;
  themeMetaOverrides?: Record<string, { name: string; description: string }>;
  selectedThemes: string[];
};

function keyForUser(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${userId}`;
}

export function readStoredCustomTheme(
  userId: string | undefined,
): StoredCustomThemePreferences | null {
  if (!userId || typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(keyForUser(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const o = parsed as Record<string, unknown>;
    if (!Array.isArray(o.customThemes)) return null;
    if (typeof o.themeKeywordOverrides !== "object" || o.themeKeywordOverrides === null)
      return null;
    if (!Array.isArray(o.selectedThemes)) return null;
    const metaOverrides =
      typeof o.themeMetaOverrides === "object" && o.themeMetaOverrides !== null
        ? (o.themeMetaOverrides as Record<string, { name: string; description: string }>)
        : {};
    return {
      customThemes: o.customThemes as StoredThemeOption[],
      themeKeywordOverrides: o.themeKeywordOverrides as Record<string, string[]>,
      themeMetaOverrides: metaOverrides,
      selectedThemes: o.selectedThemes as string[],
    };
  } catch {
    return null;
  }
}

export function writeStoredCustomTheme(
  userId: string | undefined,
  data: StoredCustomThemePreferences,
): void {
  if (!userId || typeof window === "undefined") return;
  try {
    localStorage.setItem(keyForUser(userId), JSON.stringify(data));
  } catch {
    /* quota or private mode */
  }
}
