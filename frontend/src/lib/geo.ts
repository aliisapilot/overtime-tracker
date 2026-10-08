/**
 * Geolocation & Geofence Utility
 * Implements WGS84 Haversine distance, accuracy categorization, and browser GPS polling
 */

export interface GpsCoordinates {
  lat: number;
  lon: number;
  accuracy: number; // in meters
  timestamp: number;
}

export type AccuracyLevel = 'optimal' | 'acceptable' | 'degraded';

export interface GpsValidationResult {
  valid: boolean;
  accuracyLevel: AccuracyLevel;
  accuracy: number;
  distanceMeters?: number;
  insideGeofence?: boolean;
  message: string;
}

/**
 * Categorize GPS accuracy based on UAE project specifications:
 * - <= 20m: Optimal
 * - 21m to 30m: Acceptable fallback
 * - > 30m: Degraded (Rejected)
 */
export function categorizeAccuracy(accuracy: number): { level: AccuracyLevel; label: string; color: string } {
  if (accuracy <= 20) {
    return { level: 'optimal', label: 'Optimal (±' + Math.round(accuracy) + 'm)', color: 'text-emerald-400' };
  } else if (accuracy <= 30) {
    return { level: 'acceptable', label: 'Acceptable (±' + Math.round(accuracy) + 'm)', color: 'text-amber-400' };
  } else {
    return { level: 'degraded', label: 'Degraded (±' + Math.round(accuracy) + 'm)', color: 'text-rose-400' };
  }
}

/**
 * Calculate Haversine distance between two coordinates in meters
 */
export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * Acquire current position with high-accuracy GPS
 */
export function getCurrentPosition(timeoutMs: number = 15000): Promise<GpsCoordinates> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Geolocation is not supported by your browser or device.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp,
        });
      },
      (error) => {
        let errorMsg = 'Failed to obtain GPS location.';
        switch (error.code) {
          case error.PERMISSION_DENIED:
            errorMsg = 'Location permission denied. Please allow location access in your device/browser settings to clock in.';
            break;
          case error.POSITION_UNAVAILABLE:
            errorMsg = 'GPS signal unavailable. Please ensure location services are turned on and step into an open area.';
            break;
          case error.TIMEOUT:
            errorMsg = 'GPS acquisition timed out. Please try again.';
            break;
        }
        reject(new Error(errorMsg));
      },
      {
        enableHighAccuracy: true,
        timeout: timeoutMs,
        maximumAge: 0,
      }
    );
  });
}
