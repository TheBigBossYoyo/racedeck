import { useEffect, useMemo } from 'react'
import { useSessionStore } from '@renderer/store/sessionStore'
import { usePracticeStore } from '@renderer/store/practiceStore'
import type { RaceSnapshot } from '@renderer/core/model/snapshot'
import type { PracticeBriefRequest } from '@shared/practice'

function requestFrom(snapshot: RaceSnapshot | null): PracticeBriefRequest | null {
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
}

export function usePracticeBriefing() {
  const snapshot = useSessionStore((state) => state.snapshot)
  const store = usePracticeStore()
  const built = requestFrom(snapshot)
  const signature = built ? JSON.stringify(built) : null
  // Every provider publish is a new snapshot object, so keying on it rebuilt the
  // request (and re-fired the load effect) at the data rate. The request's own
  // content is what matters, and `signature` captures all of it.
  const request = useMemo(() => built, [signature]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (request) void store.load(request)
  }, [request, store.load])

  const refresh = () => {
    store.clear()
    if (request) void store.load(request)
  }

  return { snapshot, request, refresh, ...store }
}
