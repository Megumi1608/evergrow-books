export const THEME_COLOR_KEYS = [
  'bg',
  'surface',
  'surfaceMuted',
  'ink',
  'inkSoft',
  'muted',
  'line',
  'lineStrong',
  'income',
  'expense',
  'warning',
] as const;

export type ThemeColorKey = (typeof THEME_COLOR_KEYS)[number];
export type ThemeColors = Record<ThemeColorKey, string>;
export type ThemePresetId = 'mono' | 'paper' | 'cool' | 'dark';
export type ThemePresetChoice = ThemePresetId | 'custom';

export interface ThemeSettings {
  preset: ThemePresetChoice;
  colors: ThemeColors;
}

export interface ThemePreset {
  id: ThemePresetId;
  name: string;
  description: string;
  colors: ThemeColors;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'mono',
    name: 'Mono',
    description: 'Trắng đen, nhấn xanh – đỏ – vàng',
    colors: {
      bg: '#F7F7F7',
      surface: '#FFFFFF',
      surfaceMuted: '#EFEFEF',
      ink: '#101010',
      inkSoft: '#3C3C3C',
      muted: '#7A7A7A',
      line: '#E6E6E6',
      lineStrong: '#D4D4D4',
      income: '#177245',
      expense: '#B42318',
      warning: '#9A6700',
    },
  },
  {
    id: 'paper',
    name: 'Giấy',
    description: 'Nền giấy ấm, chữ than',
    colors: {
      bg: '#F5F4F0',
      surface: '#FFFFFF',
      surfaceMuted: '#EFEDE7',
      ink: '#1C1C19',
      inkSoft: '#4B4B44',
      muted: '#85857B',
      line: '#E4E2DA',
      lineStrong: '#D8D5CB',
      income: '#1E5B45',
      expense: '#A44A2A',
      warning: '#96610A',
    },
  },
  {
    id: 'cool',
    name: 'Khói',
    description: 'Xám lạnh, dịu mắt',
    colors: {
      bg: '#F4F6F7',
      surface: '#FFFFFF',
      surfaceMuted: '#ECF0F2',
      ink: '#15191C',
      inkSoft: '#3D464D',
      muted: '#74808A',
      line: '#DDE4E8',
      lineStrong: '#C9D3D9',
      income: '#0F766E',
      expense: '#B42318',
      warning: '#8A5B00',
    },
  },
  {
    id: 'dark',
    name: 'Đêm',
    description: 'Nền than, chữ sáng',
    colors: {
      bg: '#0D0D0D',
      surface: '#171717',
      surfaceMuted: '#1F1F1F',
      ink: '#F5F5F5',
      inkSoft: '#C9C9C9',
      muted: '#8B8B8B',
      line: '#2A2A2A',
      lineStrong: '#3A3A3A',
      income: '#4ADE80',
      expense: '#F87171',
      warning: '#FBBF24',
    },
  },
];

export const DEFAULT_THEME: ThemeSettings = {
  preset: 'mono',
  colors: { ...THEME_PRESETS[0].colors },
};

export const THEME_VAR_MAP: Record<ThemeColorKey, string> = {
  bg: '--bg',
  surface: '--surface',
  surfaceMuted: '--surface-muted',
  ink: '--ink',
  inkSoft: '--ink-2',
  muted: '--muted',
  line: '--line',
  lineStrong: '--line-strong',
  income: '--income',
  expense: '--expense',
  warning: '--warning',
};

export function cloneTheme(theme: ThemeSettings): ThemeSettings {
  return { preset: theme.preset, colors: { ...theme.colors } };
}

export function getThemePreset(id: ThemePresetChoice): ThemePreset | undefined {
  return THEME_PRESETS.find((preset) => preset.id === id);
}

export function isDarkTheme(theme: ThemeSettings): boolean {
  const hex = theme.colors.bg.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.45;
}

export function themesEqual(a: ThemeSettings, b: ThemeSettings): boolean {
  return THEME_COLOR_KEYS.every((key) => a.colors[key].toUpperCase() === b.colors[key].toUpperCase());
}
