export const DEFAULT_TIME_ZONE = "Europe/Madrid";

export type DateTimeLocalDisambiguation = "reject" | "earlier" | "later";

export type TimeZoneErrorCode =
  | "INVALID_DATE_TIME_LOCAL"
  | "INVALID_INSTANT"
  | "INVALID_TIME_ZONE"
  | "NONEXISTENT_LOCAL_TIME"
  | "AMBIGUOUS_LOCAL_TIME";

export class TimeZoneError extends RangeError {
  constructor(
    public readonly code: TimeZoneErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TimeZoneError";
  }
}

export interface ZonedDateTimeLocalOptions {
  /**
   * Policy for a wall-clock time repeated when daylight saving time ends.
   *
   * The safe default is `reject`, so an operational deadline never moves by an
   * hour silently. `earlier` and `later` select the first or second occurrence
   * explicitly. Wall-clock times skipped when DST starts are always rejected.
   */
  disambiguation?: DateTimeLocalDisambiguation;
}

type InstantInput = Date | number | string;

interface LocalDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

const DATE_TIME_LOCAL_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const EXPLICIT_OFFSET_PATTERN = /(?:Z|[+-]\d{2}:\d{2})$/i;
const HOUR_IN_MS = 60 * 60 * 1000;
const OFFSET_PROBE_HOURS = [-72, -48, -24, -12, 0, 12, 24, 48, 72];

const localPartsFormatters = new Map<string, Intl.DateTimeFormat>();
const spanishDateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

function invalidDateTimeLocal(value: string): TimeZoneError {
  return new TimeZoneError(
    "INVALID_DATE_TIME_LOCAL",
    `El valor \"${value}\" no es una fecha datetime-local válida.`,
  );
}

function epochFromParts(parts: LocalDateTimeParts): number {
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour, parts.minute, parts.second, parts.millisecond);
  return date.getTime();
}

function partsMatch(
  left: LocalDateTimeParts,
  right: LocalDateTimeParts,
): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second &&
    left.millisecond === right.millisecond
  );
}

function parseDateTimeLocal(value: string): LocalDateTimeParts {
  const match = DATE_TIME_LOCAL_PATTERN.exec(value);

  if (!match) {
    throw invalidDateTimeLocal(value);
  }

  const parts: LocalDateTimeParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0),
    millisecond: Number((match[7] ?? "").padEnd(3, "0") || 0),
  };
  const date = new Date(epochFromParts(parts));
  const normalized: LocalDateTimeParts = {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
    millisecond: date.getUTCMilliseconds(),
  };

  if (parts.year === 0 || !partsMatch(parts, normalized)) {
    throw invalidDateTimeLocal(value);
  }

  return parts;
}

function createFormatter(
  locale: string,
  options: Intl.DateTimeFormatOptions,
  timeZone: string,
): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone });
  } catch (error) {
    if (error instanceof RangeError) {
      throw new TimeZoneError(
        "INVALID_TIME_ZONE",
        `La zona horaria \"${timeZone}\" no es una zona IANA válida.`,
      );
    }

    throw error;
  }
}

function getLocalPartsFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = localPartsFormatters.get(timeZone);

  if (cached) {
    return cached;
  }

  const formatter = createFormatter(
    "en-US-u-ca-gregory-nu-latn",
    {
      calendar: "gregory",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
      hourCycle: "h23",
    },
    timeZone,
  );
  localPartsFormatters.set(timeZone, formatter);
  return formatter;
}

function getLocalParts(instant: Date, timeZone: string): LocalDateTimeParts {
  const values: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};

  for (const part of getLocalPartsFormatter(timeZone).formatToParts(instant)) {
    values[part.type] = part.value;
  }

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    millisecond: Number(values.fractionalSecond ?? 0),
  };
}

function getOffsetMilliseconds(timestamp: number, timeZone: string): number {
  return (
    epochFromParts(getLocalParts(new Date(timestamp), timeZone)) - timestamp
  );
}

function findMatchingInstants(
  localParts: LocalDateTimeParts,
  timeZone: string,
): number[] {
  const wallClockAsUtc = epochFromParts(localParts);
  const possibleOffsets = new Set<number>();

  for (const hours of OFFSET_PROBE_HOURS) {
    let probe = wallClockAsUtc + hours * HOUR_IN_MS;

    // One extra pass also covers a transition between the UTC-shaped guess and
    // the actual instant in zones close to the date boundary.
    for (let iteration = 0; iteration < 2; iteration += 1) {
      const offset = getOffsetMilliseconds(probe, timeZone);
      possibleOffsets.add(offset);
      probe = wallClockAsUtc - offset;
    }
  }

  const matches = new Set<number>();

  for (const offset of possibleOffsets) {
    const timestamp = wallClockAsUtc - offset;

    if (partsMatch(getLocalParts(new Date(timestamp), timeZone), localParts)) {
      matches.add(timestamp);
    }
  }

  return [...matches].sort((left, right) => left - right);
}

function toInstant(value: InstantInput): Date {
  if (typeof value === "string" && !EXPLICIT_OFFSET_PATTERN.test(value)) {
    throw new TimeZoneError(
      "INVALID_INSTANT",
      "Una fecha textual debe incluir Z o un desplazamiento UTC explícito.",
    );
  }

  const instant =
    value instanceof Date ? new Date(value.getTime()) : new Date(value);

  if (Number.isNaN(instant.getTime())) {
    throw new TimeZoneError(
      "INVALID_INSTANT",
      "El instante indicado no es válido.",
    );
  }

  return instant;
}

/**
 * Interprets an HTML `datetime-local` value as wall-clock time in an IANA zone.
 *
 * It does not use the host or browser time zone. Nonexistent DST times are
 * rejected. Repeated DST times are rejected unless the caller explicitly asks
 * for their `earlier` or `later` occurrence.
 */
export function zonedDateTimeLocalToUtc(
  value: string,
  timeZone = DEFAULT_TIME_ZONE,
  { disambiguation = "reject" }: ZonedDateTimeLocalOptions = {},
): Date {
  const localParts = parseDateTimeLocal(value);
  const matches = findMatchingInstants(localParts, timeZone);

  if (matches.length === 0) {
    throw new TimeZoneError(
      "NONEXISTENT_LOCAL_TIME",
      `La hora local \"${value}\" no existe en ${timeZone} por el cambio horario.`,
    );
  }

  if (matches.length === 1) {
    return new Date(matches[0]);
  }

  if (disambiguation === "earlier") {
    return new Date(matches[0]);
  }

  if (disambiguation === "later") {
    return new Date(matches[matches.length - 1]);
  }

  throw new TimeZoneError(
    "AMBIGUOUS_LOCAL_TIME",
    `La hora local \"${value}\" ocurre dos veces en ${timeZone}; elige earlier o later.`,
  );
}

/** Formats an instant for the value of an HTML `datetime-local` control. */
export function formatDateTimeLocalInTimeZone(
  value: InstantInput,
  timeZone = DEFAULT_TIME_ZONE,
): string {
  const parts = getLocalParts(toInstant(value), timeZone);
  const pad = (part: number) => String(part).padStart(2, "0");

  return `${String(parts.year).padStart(4, "0")}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

/** Formats an instant in Spanish and includes the active zone abbreviation. */
export function formatDateTimeInTimeZone(
  value: InstantInput,
  timeZone = DEFAULT_TIME_ZONE,
): string {
  let formatter = spanishDateTimeFormatters.get(timeZone);

  if (!formatter) {
    formatter = createFormatter(
      "es-ES",
      {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
        hourCycle: "h23",
      },
      timeZone,
    );
    spanishDateTimeFormatters.set(timeZone, formatter);
  }

  return formatter.format(toInstant(value));
}
