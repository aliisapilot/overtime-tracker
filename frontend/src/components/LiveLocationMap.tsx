import React, { useEffect, useRef } from 'react';
import L, { type Map as LeafletMap } from 'leaflet';

interface LiveLocationMapProps {
  userLat: number;
  userLon: number;
  userAccuracy?: number;
  height?: string;
  label?: string;
}

export default function LiveLocationMap({
  userLat,
  userLon,
  userAccuracy = 15,
  height = '260px',
  label = 'Your Current GPS Location',
}: LiveLocationMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<LeafletMap | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [userLat, userLon],
        zoom: 17,
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

    // 1. Worker Location Marker
    const userIcon = L.divIcon({
      className: 'custom-live-marker',
      html: `<div style="background-color: #10b981; width: 28px; height: 28px; border-radius: 50%; border: 3px solid white; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 14px rgba(16,185,129,0.7);"><span style="color: white; font-size: 13px;">📍</span></div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });

    L.marker([userLat, userLon], { icon: userIcon })
      .addTo(map)
      .bindPopup(`<b>${label}</b><br>Coordinates: ${userLat.toFixed(5)}, ${userLon.toFixed(5)}<br>Accuracy: ±${Math.round(userAccuracy)}m`)
      .openPopup();

    // 2. Accuracy circle
    if (userAccuracy > 0) {
      L.circle([userLat, userLon], {
        radius: userAccuracy,
        color: '#10b981',
        weight: 1.5,
        fillColor: '#10b981',
        fillOpacity: 0.12,
      }).addTo(map);
    }

    map.setView([userLat, userLon], 17);

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [userLat, userLon, userAccuracy, label]);

  return (
    <div
      className="relative w-full rounded-2xl overflow-hidden border border-slate-700/80 shadow-inner bg-slate-950"
      style={{ height }}
    >
      <div ref={mapContainerRef} className="w-full h-full" />
      <div className="absolute bottom-2 left-2 z-[400] bg-slate-900/90 backdrop-blur-md border border-slate-700/80 px-2.5 py-1 rounded-lg text-[11px] font-mono text-slate-300 shadow-lg pointer-events-none">
        <span className="text-emerald-400 font-semibold">📍</span> {userLat.toFixed(5)}, {userLon.toFixed(5)} • ±{Math.round(userAccuracy)}m
      </div>
    </div>
  );
}
