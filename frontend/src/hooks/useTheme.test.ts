import { renderHook, act } from '@testing-library/react';
import useTheme, { initTheme } from '@/hooks/useTheme';

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('defaults to system theme', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('system');
  });

  it('applies data-theme attribute to html element', () => {
    const { result } = renderHook(() => useTheme());
    act(() => {
      result.current.setTheme('dark');
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('toggles between light and dark', () => {
    const { result } = renderHook(() => useTheme());
    act(() => {
      result.current.setTheme('light');
    });
    expect(result.current.resolved).toBe('light');

    act(() => {
      result.current.toggle();
    });
    expect(result.current.resolved).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    act(() => {
      result.current.toggle();
    });
    expect(result.current.resolved).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('persists theme to localStorage', () => {
    const { result } = renderHook(() => useTheme());
    act(() => {
      result.current.setTheme('dark');
    });
    expect(localStorage.getItem('porchsongs_theme')).toBe('dark');
  });

  it('reads stored theme from localStorage', () => {
    localStorage.setItem('porchsongs_theme', 'dark');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
    expect(result.current.resolved).toBe('dark');
  });
});

describe('initTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  // The marketing routes and headerless play mode never mount useTheme, so the
  // bootstrap call in main.tsx is the only thing theming them.
  it('applies the stored theme with no component mounted', () => {
    localStorage.setItem('porchsongs_theme', 'dark');
    initTheme();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('resolves the system preference when nothing is stored', () => {
    initTheme();
    // setup.ts mocks matchMedia with matches: false, i.e. a light-mode OS
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
