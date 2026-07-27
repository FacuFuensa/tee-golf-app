/**
 * OpenWeatherMap credentials (openweathermap.org).
 *
 * Provide your key as an env var in `expo/.env`:
 *   EXPO_PUBLIC_OPENWEATHER_API_KEY=...
 *
 * Get a free key at https://openweathermap.org/api (sign up with just an email).
 * Free tier = 1,000 calls/day, which is plenty: Tee only fetches weather on
 * round start and then refreshes per hole / every few minutes.
 *
 * Note: this is an EXPO_PUBLIC_ key, so it ships inside the app bundle. That's
 * expected for OpenWeatherMap's client-side current-weather endpoint. Keep the
 * key out of the UI layer (read it only here) and rotate it from your dashboard
 * if needed.
 */
const PLACEHOLDER_KEY = "YOUR-OPENWEATHER-KEY";

export const OPENWEATHER_BASE_URL = "https://api.openweathermap.org/data/2.5/weather";

export const OPENWEATHER_API_KEY: string =
  process.env.EXPO_PUBLIC_OPENWEATHER_API_KEY ?? PLACEHOLDER_KEY;

/** True once a real key is in place — used to skip fetches and show a notice. */
export const isWeatherConfigured: boolean =
  OPENWEATHER_API_KEY.length > 0 && OPENWEATHER_API_KEY !== PLACEHOLDER_KEY;
