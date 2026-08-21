import { useEffect, useMemo } from 'react'
import { useSessionStore } from '@renderer/store/sessionStore'
import { usePracticeStore } from '@renderer/store/practiceStore'
import type { PracticeBriefRequest } from '@shared/practice'

export function usePracticeBriefing() {
  const snapshot = useSessionStore((state) => state.snapshot)
  const store = usePracticeStore()
  const request = useMemo<PracticeBriefRequest | null>(() => {
    if (!snapshot) return null
    return {
      year: snapshot.session.year,
      meetingName: snapshot.session.meetingName,
      countryName: snapshot.session.countryName,
      dateStart: snapshot.session.dateStart,
      drivers: snapshot.drivers.map((driver) => ({
        number: driver.number,
        code: driver.code,
        fullName: driver.fullName,
        teamName: driver.teamName
      }))
    }
  }, [snapshot])

  useEffect(() => {
    if (request) void store.load(request)
  }, [request, store.load])

  const refresh = () => {
    store.clear()
    if (request) void store.load(request)
  }

  return { snapshot, request, refresh, ...store }
}
