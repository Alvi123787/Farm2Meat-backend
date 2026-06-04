/**
 * Helper to get a single, valid frontend origin URL.
 * Handles comma-separated FRONTEND_ORIGIN values and prefers FRONTEND_URL if set.
 */
export const getFrontendOrigin = () => {
  if (process.env.FRONTEND_URL) return process.env.FRONTEND_URL.replace(/\/$/, '')
  const origins = process.env.FRONTEND_ORIGIN || 'http://localhost:5173'
  // If comma-separated, pick the first one (usually the primary production URL)
  return origins.split(',')[0].trim().replace(/\/$/, '')
}
