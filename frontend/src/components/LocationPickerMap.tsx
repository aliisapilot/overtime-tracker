import React, { useEffect, useRef, useState, useCallback } from 'react';
import L, { type Map as LeafletMap, type Marker as LeafletMarker, type Circle as LeafletCircle } from 'leaflet';

interface LocationPickerMapProps {
  lat: number;
  lon: number;
  radius: number;
  onLocationChange: (lat: number, lon: number) => void;
  height?: string;
}

export default function LocationPickerMap({
  lat,
  lon,
  radius,
  onLocationChange,
  height = '320px',
}: LocationPickerMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<LeafletMarker | null>(null);
  const circleRef = useRef<LeafletCircle | null>(null);

  const [locatingUser, setLocatingUser] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const initialMap = L.map(mapContainerRef.current, {
        center: [lat, lon],
        zoom: 16,
        zoomControl: true,
      });

      // Free OpenStreetMap Tile Layer
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(initialMap);

      // Custom Construction/Job Site Pin Icon
      const pinIcon = L.divIcon({
        className: 'custom-picker-marker',
        html: `<div style="background-color: #2563eb; width: 34px; height: 34px; border-radius: 50%; border: 3px solid white; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(37,99,235,0.5); cursor: grab;"><span style="color: white; font-size: 16px;">📍</span></div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      });

      // Draggable Marker
      const initialMarker = L.marker([lat, lon], {
        draggable: true,
        icon: pinIcon,
      }).addTo(initialMap);

      initialMarker.bindTooltip('Drag or tap map to position site', {
        permanent: false,
        direction: 'top',
      });

      // Marker Drag Event
      initialMarker.on('dragend', () => {
        const pos = initialMarker.getLatLng();
        onLocationChange(pos.lat, pos.lng);
      });

      // Geofence Circle
      const initialCircle = L.circle([lat, lon], {
        radius: radius,
        color: '#3b82f6',
        weight: 2,
        fillColor: '#3b82f6',
        fillOpacity: 0.18,
        dashArray: '6, 6',
      }).addTo(initialMap);

      // Map Click Event: click anywhere to move pin
      initialMap.on('click', (e) => {
        initialMarker.setLatLng(e.latlng);
        initialCircle.setLatLng(e.latlng);
        onLocationChange(e.latlng.lat, e.latlng.lng);
      });

      mapInstanceRef.current = initialMap;
      markerRef.current = initialMarker;
      circleRef.current = initialCircle;
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markerRef.current = null;
        circleRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update position & circle when lat/lon changes externally (e.g. search, link paste)
  useEffect(() => {
    if (!mapInstanceRef.current || !markerRef.current || !circleRef.current) return;

    const currentLatLng = markerRef.current.getLatLng();
    const distance = currentLatLng.distanceTo([lat, lon]);

    if (distance > 1) {
      markerRef.current.setLatLng([lat, lon]);
      circleRef.current.setLatLng([lat, lon]);
      mapInstanceRef.current.setView([lat, lon], 16, { animate: true });
    }
  }, [lat, lon]);

  // Update geofence circle radius when prop changes
  useEffect(() => {
    if (circleRef.current) {
      circleRef.current.setRadius(radius);
    }
  }, [radius]);

  // Handle "Use My Current Location"
  const handleUseCurrentLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsError('Geolocation is not supported by your device browser.');
      return;
    }
    setLocatingUser(true);
    setGpsError(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocatingUser(false);
        const userLat = pos.coords.latitude;
        const userLon = pos.coords.longitude;
        onLocationChange(userLat, userLon);

        if (mapInstanceRef.current && markerRef.current && circleRef.current) {
          markerRef.current.setLatLng([userLat, userLon]);
          circleRef.current.setLatLng([userLat, userLon]);
          mapInstanceRef.current.setView([userLat, userLon], 17, { animate: true });
        }
      },
      (err) => {
        setLocatingUser(false);
        setGpsError(
          err.code === 1
            ? 'Location access denied. Please enable location permissions in your browser.'
            : 'Unable to acquire accurate GPS position.'
        );
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 10000,
      }
    );
  }, [onLocationChange]);

  return (
    <div className="space-y-2">
      {/* Map Control Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-slate-400 flex items-center gap-1.5 font-medium">
          <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
          Drag pin or click map to adjust site center
        </span>
        <button
          type="button"
          onClick={handleUseCurrentLocation}
          disabled={locatingUser}
          className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-blue-400 hover:text-blue-300 border border-slate-700 font-semibold transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50"
        >
          <span className={locatingUser ? 'animate-spin' : ''}>📍</span>
          <span>{locatingUser ? 'Locating...' : 'Use My Current Location'}</span>
        </button>
      </div>

      {gpsError && (
        <div className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
          {gpsError}
        </div>
      )}

      {/* Map Container */}
      <div
        className="relative w-full rounded-2xl overflow-hidden border border-slate-700/80 shadow-inner bg-slate-950"
        style={{ height }}
      >
        <div ref={mapContainerRef} className="w-full h-full" />

        {/* Live Coordinate Badge in Bottom Left */}
        <div className="absolute bottom-2 left-2 z-[400] bg-slate-900/90 backdrop-blur-md border border-slate-700/80 px-2.5 py-1 rounded-lg text-[11px] font-mono text-slate-300 shadow-lg pointer-events-none">
          <span className="text-blue-400 font-semibold">📍</span> {lat.toFixed(6)}, {lon.toFixed(6)} • <span className="text-emerald-400 font-semibold">{radius}m</span> geofence
        </div>
      </div>
    </div>
  );
}
