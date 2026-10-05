import React, { createContext, useContext, useEffect } from 'react';
import useWxtStorage from '@/hooks/useWxtStorage';
import type { StorageItemKey } from '#imports';

import { createLogger } from '@/lib/logger';
import { THEME_STORAGE_KEY } from '@/constants/general-settings';

const logger = createLogger('content:theme-provider');

type Theme = 'dark' | 'light' | 'system';

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
  container?: HTMLElement | null;
};

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const initialState: ThemeProviderState = {
  theme: 'system',
  setTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = THEME_STORAGE_KEY,
  container,
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useWxtStorage<Theme>(storageKey as StorageItemKey, defaultTheme);

  // Seed from the OS preference (or the manual default) instead of a hardcoded
  // 'light': the storage read is async, so a dark-mode user got one frame of
  // light classes before the effect ran.
  const [resolvedTheme, setResolvedTheme] = React.useState<Theme>(() => {
    if (defaultTheme !== 'system') return defaultTheme;

    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    // If container is explicitly provided as null, we might be waiting for it.
    // If container is undefined, we default to document.documentElement.
    const root = container !== undefined ? container : window.document.documentElement;
    
    if (!root) {
      logger.debug('[ThemeProvider] No theme root yet; skipping.');
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const applyTheme = () => {
      root.classList.remove('light', 'dark');

      let currentTheme = theme;
      if (theme === 'system') {
        currentTheme = mediaQuery.matches ? 'dark' : 'light';
      }

      root.classList.add(currentTheme);
      setResolvedTheme(currentTheme);
      logger.debug('[ThemeProvider] Applied theme', currentTheme);
    };

    applyTheme();

    const handler = () => {
      if (theme === 'system') {
        applyTheme();
      }
    };

    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [theme, container]);

  return (
    <ThemeProviderContext.Provider {...props} value={{ theme, setTheme }}>
      <div className={resolvedTheme} style={{ display: 'contents' }}>
        {children}
      </div>
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);
  if (context === undefined)
    throw new Error('useTheme must be used within a ThemeProvider');
  return context;
};
