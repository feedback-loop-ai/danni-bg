import { type Theme, cycleTheme } from '../lib/theme.ts';

const GLYPH: Record<Theme, string> = { light: '☀', dark: '☾', system: '🖥' };
const LABEL: Record<Theme, string> = {
  light: 'светла тема',
  dark: 'тъмна тема',
  system: 'системна тема',
};

interface ThemeToggleProps {
  theme: Theme;
  onChange: (next: Theme) => void;
}

/** Cycles light → dark → system. Lives in the header (on the primary bar). */
export function ThemeToggle({ theme, onChange }: ThemeToggleProps) {
  return (
    <button
      type="button"
      aria-label={`Тема: ${LABEL[theme]}`}
      title={`Тема: ${LABEL[theme]}`}
      onClick={() => onChange(cycleTheme(theme))}
      className="flex size-8 items-center justify-center rounded-md text-base text-primary-foreground/90 hover:bg-white/15"
    >
      {GLYPH[theme]}
    </button>
  );
}
