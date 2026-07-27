import {
  OPENWEATHER_API_KEY,
  OPENWEATHER_BASE_URL,
  isWeatherConfigured,
} from "./weatherConfig";

/**
 * Current on-course conditions, normalized to SI so the plays-like engine stays
 * unit-agnostic:
 *  - tempC          air temperature in °C
 *  - windSpeedMps   wind speed in meters/second
 *  - windFromDeg    meteorological wind direction (degrees the wind blows FROM,
 *                   0 = from north, 90 = from east)
 */
export interface Weather {
  tempC: number;
  windSpeedMps: number;
  windFromDeg: number;
  description: string;
  fetchedAt: number;
}

interface OpenWeatherResponse {
  main?: { temp?: number };
  wind?: { speed?: number; deg?: number };
  weather?: { description?: string }[];
}

/**
 * Fetch current weather for a GPS coordinate via OpenWeatherMap. Returns null
 * when no API key is configured so the caddy can gracefully fall back to a
 * raw-distance recommendation instead of erroring.
 */
export async function fetchWeather(
  latitude: number,
  longitude: number
): Promise<Weather | null> {
  if (!isWeatherConfigured) return null;

  const url =
    `${OPENWEATHER_BASE_URL}?lat=${latitude}&lon=${longitude}` +
    `&units=metric&appid=${OPENWEATHER_API_KEY}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Weather request failed (${res.status})`);
  }
  const json = (await res.json()) as OpenWeatherResponse;

  return {
    tempC: json.main?.temp ?? 21,
    windSpeedMps: json.wind?.speed ?? 0,
    windFromDeg: json.wind?.deg ?? 0,
    description: json.weather?.[0]?.description ?? "",
    fetchedAt: Date.now(),
  };
}
