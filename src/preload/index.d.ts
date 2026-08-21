import type { RaceDeckApi } from '../shared/ipc-contract'

declare global {
  interface Window {
    racedeck: RaceDeckApi
  }
}

export {}
