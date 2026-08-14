const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

function dateParts(value: string): [number, number, number] | null {
  const match = DATE_ONLY.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const check = new Date(Date.UTC(year, month - 1, day))
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day
    ? [year, month, day]
    : null
}

export function isValidDateOnly(value: string): boolean {
  return dateParts(value) !== null
}

export function parseTimezoneOffset(value: string | number | null | undefined): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= -840 && parsed <= 840 ? parsed : 0
}

function localMidnightUtc(value: string, timezoneOffsetMinutes: number, dayOffset = 0): Date | null {
  const parts = dateParts(value)
  if (!parts) return null
  const [year, month, day] = parts
  return new Date(Date.UTC(year, month - 1, day + dayOffset) + timezoneOffsetMinutes * 60_000)
}

export function localDateRangeToUtc(
  dateFrom?: string | null,
  dateTo?: string | null,
  timezoneOffsetMinutes = 0,
): { startIso?: string; endExclusiveIso?: string } {
  const offset = parseTimezoneOffset(timezoneOffsetMinutes)
  const start = dateFrom ? localMidnightUtc(dateFrom, offset) : null
  const endExclusive = dateTo ? localMidnightUtc(dateTo, offset, 1) : null
  const result: { startIso?: string; endExclusiveIso?: string } = {}
  if (start) result.startIso = start.toISOString()
  if (endExclusive) result.endExclusiveIso = endExclusive.toISOString()
  return result
}

export function formatDateOnly(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}
