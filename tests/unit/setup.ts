import '@testing-library/jest-dom'
import { beforeEach } from 'vitest'
import { persist } from '@renderer/store/persist'

// Ensure a clean persistence layer between tests.
beforeEach(() => {
  persist.__resetMemory()
  try {
    localStorage.clear()
  } catch {
    /* jsdom may not expose localStorage in every context */
  }
})
