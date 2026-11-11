/**
 * system_settings.value is `jsonb not null`, and PostgREST turns a JSON null
 * into SQL NULL — so an optional setting left empty (logo URL, support phone)
 * is stored as "" and read back as null.
 */
export function settingToStorage(value: unknown): unknown {
  return value === null || value === undefined ? "" : value;
}

export function settingFromStorage(value: unknown): unknown {
  return value === "" ? null : value;
}

/** Rows to upsert into system_settings — never contains a null value. */
export function settingsRows(data: Record<string, unknown>, actorId: string) {
  return Object.entries(data).map(([key, value]) => ({ key, value: settingToStorage(value), updated_by: actorId }));
}
