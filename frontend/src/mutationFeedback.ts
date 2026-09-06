export function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function savedWithRefreshWarning(
  savedMessage: string,
  error: unknown,
) {
  return `${savedMessage} The save succeeded, but the record could not be refreshed: ${errorMessage(
    error,
    "unknown refresh error",
  )}`;
}
