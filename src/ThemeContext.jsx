
import { createContext, useEffect, useState } from 'react'
export const ThemeContext = createContext()
export function ThemeProvider({ children }) {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const [theme, setTheme] = useState(localStorage.getItem('theme') || (prefersDark ? 'dark' : 'light'))
  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('light','dark'); root.classList.add(theme)
    localStorage.setItem('theme', theme)
  }, [theme])
  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark')
  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>
}
