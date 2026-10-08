import React, { useEffect, useRef } from 'react';
import L, { type Map as LeafletMap } from 'leaflet';

interface GeofenceMapProps {
  siteLat: number;
  siteLon: number;
  siteName: string;
  geofenceRadius: number; // in meters
  userLat?: number;
  userLon?: number;
  userAccuracy?: number;
  insideGeofence?: boolean;
}

export default function GeofenceMap({
  siteLat,
  siteLon,
  siteName,
  geofenceRadius,
  userLat,
  userLon,
  userAccuracy,
  insideGeofence = false,
}: GeofenceMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<LeafletMap | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [siteLat, siteLon],
        zoom: 16,
        zoomControl: true,
      });

      // Free OpenStreetMap Tile Layer
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);

      mapInstanceRef.current = map;
    }

    const map = mapInstanceRef.current;

    // Clear previous layers except tile layer
    map.eachLayer((layer) => {
      if (layer instanceof L.Marker || layer instanceof L.Circle) {
        map.removeLayer(layer);
      }
    });

    // 1. Site Marker (Blue)
    const siteIcon = L.divIcon({
      className: 'custom-site-marker',
      html: `<div style="background-color: #3b82f6; width: 28px; height: 28px; border-radius: 50%; border: 3px solid white; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 6px rgba(0,0,0,0.3);"><span style="color: white; font-size: 13px; font-weight: bold;">🏢</span></div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });

    L.marker([siteLat, siteLon], { icon: siteIcon })
      .addTo(map)
      .bindPopup(`<b>${siteName}</b><br>Geofence Radius: ${geofenceRadius}m`);

    // 2. Geofence Boundary Circle
    L.circle([siteLat, siteLon], {
      radius: geofenceRadius,
      color: '#3b82f6',
      weight: 2,
      fillColor: '#3b82f6',
      fillOpacity: 0.15,
      dashArray: '4, 6',
    }).addTo(map);

    // 3. User Location Marker & Accuracy Circle (if GPS acquired)
    if (userLat !== undefined && userLon !== undefined) {
      const userColor = insideGeofence ? '#10b981' : '#f43f5e';
      const userIcon = L.divIcon({
        className: 'custom-user-marker',
        html: `<div style="background-color: ${userColor}; width: 22px; height: 22px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 12px ${userColor};"></div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });

      L.marker([userLat, userLon], { icon: userIcon })
        .addTo(map)
        .bindPopup(
          `<b>Your Current Location</b><br>${
            insideGeofence ? '✓ Inside Geofence' : '✗ Outside Geofence'
          }<br>GPS Accuracy: ±${Math.round(userAccuracy || 0)}m`
        );

      if (userAccuracy && userAccuracy > 0) {
        L.circle([userLat, userLon], {
          radius: userAccuracy,
          color: userColor,
          weight: 1,
          fillColor: userColor,
          fillOpacity: 0.08,
        }).addTo(map);
      }

      // Auto-fit to view both site and user
      const bounds = L.latLngBounds([
        [siteLat, siteLon],
        [userLat, userLon],
      ]);
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 17 });
    } else {
      map.setView([siteLat, siteLon], 16);
    }
  }, [siteLat, siteLon, siteName, geofenceRadius, userLat, userLon, userAccuracy, insideGeofence]);

  return (
    <div className="w-full h-64 sm:h-80 rounded-2xl overflow-hidden border border-slate-700/80 shadow-inner relative z-0">
      <div ref={mapContainerRef} className="w-full h-full" />
    </div>
  );
}
