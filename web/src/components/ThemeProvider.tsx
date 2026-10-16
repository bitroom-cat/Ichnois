'use client';

import * as React from 'react';
import { ThemeProvider as NextThemesProvider, useTheme as useNextTheme } from 'next-themes';

export function useTheme() {
  const { theme, resolvedTheme, setTheme, systemTheme } = useNextTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const current = resolvedTheme || theme || 'dark';

  const toggleTheme = React.useCallback(() => {
    const next = current === 'dark' ? 'light' : 'dark';
    setTheme(next);
  }, [current, setTheme]);

  return {
    theme: current,
    resolvedTheme,
    systemTheme,
    setTheme,
    toggleTheme,
    mounted,
  };
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={true}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
