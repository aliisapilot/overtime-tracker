/**
 * Utilities for resolving Google Maps URLs, coordinate strings, and free Nominatim OpenStreetMap geocoding.
 */

export interface LocationParseResult {
  success: boolean;
  lat?: number;
  lon?: number;
  name?: string;
  address?: string;
  isShortLink?: boolean;
  rawUrl?: string;
  error?: string;
}

export interface GeocodingSearchResult {
  displayName: string;
  name: string;
  lat: number;
  lon: number;
}

/**
 * Parses a Google Maps link or raw coordinates string.
 * Supports:
 * - @lat,lon (e.g. /maps/@25.2048,55.2708,17z)
 * - /place/<name>/@lat,lon
 * - Embedded data params (!3d<lat>!4d<lon>)
 * - Query params (?q=lat,lon or ?ll=lat,lon or ?daddr=lat,lon)
 * - Raw lat,lon text (e.g. "25.2048, 55.2708")
 * - Detects shortened URLs (maps.app.goo.gl, goo.gl/maps) safely without inventing coordinates
 */
export function parseGoogleMapsUrlOrCoords(input: string): LocationParseResult {
  const trimmed = (input || '').trim();
  if (!trimmed) {
    return { success: false, error: 'Please enter a Google Maps link or coordinates.' };
  }

  // 1. Raw Coordinates: "25.204849, 55.270782" or "25.2048,55.2708"
  const rawCoordMatch = trimmed.match(/^([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)$/);
  if (rawCoordMatch) {
    const lat = parseFloat(rawCoordMatch[1]);
    const lon = parseFloat(rawCoordMatch[2]);
    if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      return { success: true, lat, lon };
    }
    return { success: false, error: 'Coordinates are out of valid range (-90 to 90, -180 to 180).' };
  }

  // 2. Shortened Google Maps links (maps.app.goo.gl or goo.gl/maps)
  if (trimmed.includes('maps.app.goo.gl') || trimmed.includes('goo.gl/maps')) {
    return {
      success: false,
      isShortLink: true,
      rawUrl: trimmed,
      error:
        'Shortened Google Maps links (maps.app.goo.gl) cannot be resolved directly due to browser privacy policies. Click "Open Link" to open it in Google Maps, copy the full URL from your browser address bar, search the location name above, or tap the pin on the map.',
    };
  }

  let extractedLat: number | undefined;
  let extractedLon: number | undefined;
  let extractedName: string | undefined;

  // Extract place name if present in /place/<Name>/...
  const placeMatch = trimmed.match(/\/maps\/place\/([^/@?]+)/);
  if (placeMatch && placeMatch[1]) {
    try {
      extractedName = decodeURIComponent(placeMatch[1].replace(/\+/g, ' '));
    } catch {
      extractedName = placeMatch[1].replace(/\+/g, ' ');
    }
  }

  // Priority A: Data tag coordinates (!3d<lat>!4d<lon>) - specific pin position
  const dataMatch = trimmed.match(/!3d([+-]?\d+\.\d+)!4d([+-]?\d+\.\d+)/);
  if (dataMatch) {
    const lat = parseFloat(dataMatch[1]);
    const lon = parseFloat(dataMatch[2]);
    if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      extractedLat = lat;
      extractedLon = lon;
    }
  }

  // Priority B: Query parameter coordinates: ?q=lat,lon or ?ll=lat,lon or ?daddr=lat,lon or ?query=lat,lon
  if (extractedLat === undefined) {
    const qCoordMatch = trimmed.match(/[?&](?:q|ll|daddr|query)=([+-]?\d+\.\d+),([+-]?\d+\.\d+)/);
    if (qCoordMatch) {
      const lat = parseFloat(qCoordMatch[1]);
      const lon = parseFloat(qCoordMatch[2]);
      if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        extractedLat = lat;
        extractedLon = lon;
      }
    }
  }

  // Priority C: Center path coordinates: /@lat,lon
  if (extractedLat === undefined) {
    const atMatch = trimmed.match(/@([+-]?\d+\.\d+),([+-]?\d+\.\d+)/);
    if (atMatch) {
      const lat = parseFloat(atMatch[1]);
      const lon = parseFloat(atMatch[2]);
      if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        extractedLat = lat;
        extractedLon = lon;
      }
    }
  }

  if (extractedLat !== undefined && extractedLon !== undefined) {
    return {
      success: true,
      lat: extractedLat,
      lon: extractedLon,
      name: extractedName,
    };
  }

  // If no coordinates could be parsed
  return {
    success: false,
    name: extractedName,
    error: extractedName
      ? `Extracted place "${extractedName}", but coordinates could not be parsed from this link. Try searching for it above or placing the pin on the map.`
      : 'Could not extract valid GPS coordinates from this link. Please paste a full Google Maps URL with coordinates, or use the interactive map.',
  };
}

/**
 * Free Nominatim OpenStreetMap address & place search
 * Rate-limited and compliant with OpenStreetMap Usage Policy
 */
export async function searchNominatim(
  query: string,
  signal?: AbortSignal
): Promise<GeocodingSearchResult[]> {
  const cleanQuery = query.trim();
  if (cleanQuery.length < 2) return [];

  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
    cleanQuery
  )}&limit=5&addressdetails=1&accept-language=en`;

  try {
    const response = await fetch(url, {
      signal,
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) return [];

    interface NominatimItem {
      display_name: string;
      name?: string;
      lat: string;
      lon: string;
    }

    const data: NominatimItem[] = await response.json();
    return data.map((item) => ({
      displayName: item.display_name,
      name: item.name || item.display_name.split(',')[0].trim(),
      lat: parseFloat(item.lat),
      lon: parseFloat(item.lon),
    }));
  } catch {
    return [];
  }
}
