import {
  DEFAULT_THEME,
  THEME_COLOR_KEYS,
  THEME_VAR_MAP,
  getThemePreset,
  isDarkTheme,
  type ThemeSettings,
} from '../shared/theme';

const CACHE_KEY = 'evergrow.theme.v1';

export function applyTheme(theme: ThemeSettings): void {
  const root = document.documentElement;
  for (const key of THEME_COLOR_KEYS) {
    root.style.setProperty(THEME_VAR_MAP[key], theme.colors[key]);
  }
  const dark = isDarkTheme(theme);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.colorScheme = dark ? 'dark' : 'light';
  root.style.setProperty('--logo-filter', dark ? 'grayscale(1) brightness(0) invert(1)' : 'none');
  void window.api
    ?.setWindowChrome({
      background: theme.colors.bg,
      symbol: theme.colors.ink,
    })
    .catch(() => undefined);
}

export function readCachedTheme(): ThemeSettings {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return DEFAULT_THEME;
    const parsed = JSON.parse(raw) as ThemeSettings;
    if (!parsed || !parsed.colors) return DEFAULT_THEME;
    if (parsed.preset !== 'custom') {
      const preset = getThemePreset(parsed.preset);
      return preset ? { preset: preset.id, colors: { ...preset.colors } } : DEFAULT_THEME;
    }
    for (const key of THEME_COLOR_KEYS) {
      if (!/^#[0-9a-fA-F]{6}$/.test(parsed.colors[key] ?? '')) return DEFAULT_THEME;
    }
    return { preset: 'custom', colors: { ...DEFAULT_THEME.colors, ...parsed.colors } };
  } catch {
    return DEFAULT_THEME;
  }
}

export function cacheTheme(theme: ThemeSettings): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(theme));
  } catch {
    /* storage unavailable */
  }
}
