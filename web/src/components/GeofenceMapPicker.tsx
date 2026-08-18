import { useState } from 'react';
import { MapContainer, TileLayer, Marker, Circle, Polygon, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import 'leaflet/dist/leaflet.css';

// Vite doesn't resolve Leaflet's default marker image paths automatically — the standard fix is
// to import the assets directly and re-point the default icon at them.
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

export interface LatLng {
  lat: number;
  lng: number;
}

type DrawMode = 'site' | 'geofence';

interface Props {
  siteLocation: LatLng | null;
  radiusM: number;
  polygon: LatLng[];
  onSiteLocationChange: (location: LatLng) => void;
  onPolygonChange: (polygon: LatLng[]) => void;
}

const DEFAULT_CENTER: LatLng = { lat: 44.9778, lng: -93.265 }; // arbitrary fallback so the map has somewhere to render before a site is set

function ClickHandler({ mode, onSitePick, onPolygonPick }: { mode: DrawMode; onSitePick: (p: LatLng) => void; onPolygonPick: (p: LatLng) => void }) {
  useMapEvents({
    click(e) {
      const point = { lat: e.latlng.lat, lng: e.latlng.lng };
      if (mode === 'site') onSitePick(point);
      else onPolygonPick(point);
    },
  });
  return null;
}

/** Lets a dispatcher draw a precise geofence perimeter, not just set a fallback radius — the
 * backend (jobs.polygonToWkt / fn_point_in_job_geofence) has always supported this, the web UI
 * just never exposed it. */
export function GeofenceMapPicker({ siteLocation, radiusM, polygon, onSiteLocationChange, onPolygonChange }: Props) {
  const [mode, setMode] = useState<DrawMode>('site');

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode('site')}
            className={`rounded-md px-3 py-1 text-xs font-medium ${mode === 'site' ? 'bg-brand-600 text-white' : 'border border-slate-300 text-slate-600'}`}
          >
            Click to set site
          </button>
          <button
            type="button"
            onClick={() => setMode('geofence')}
            className={`rounded-md px-3 py-1 text-xs font-medium ${mode === 'geofence' ? 'bg-brand-600 text-white' : 'border border-slate-300 text-slate-600'}`}
          >
            Click to draw geofence ({polygon.length} pt{polygon.length === 1 ? '' : 's'})
          </button>
        </div>
        {polygon.length > 0 && (
          <div className="flex gap-2">
            <button type="button" onClick={() => onPolygonChange(polygon.slice(0, -1))} className="text-xs text-slate-500 hover:underline">
              Undo point
            </button>
            <button type="button" onClick={() => onPolygonChange([])} className="text-xs text-red-500 hover:underline">
              Clear
            </button>
          </div>
        )}
      </div>

      <div className="h-72 overflow-hidden rounded-md border border-slate-300">
        <MapContainer center={siteLocation ?? DEFAULT_CENTER} zoom={siteLocation ? 17 : 12} className="h-full w-full">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ClickHandler
            mode={mode}
            onSitePick={onSiteLocationChange}
            onPolygonPick={(p) => onPolygonChange([...polygon, p])}
          />
          {siteLocation && <Marker position={siteLocation} />}
          {siteLocation && polygon.length === 0 && <Circle center={siteLocation} radius={radiusM} pathOptions={{ color: '#2563eb' }} />}
          {polygon.length >= 2 && <Polygon positions={polygon} pathOptions={{ color: '#16a34a' }} />}
        </MapContainer>
      </div>
      <p className="text-xs text-slate-500">
        {polygon.length >= 3
          ? 'Drawn geofence will be used (takes precedence over the radius fallback).'
          : polygon.length > 0
            ? 'Need at least 3 points to form a geofence — keep clicking, or clear to fall back to the radius.'
            : 'No polygon drawn — falls back to the radius circle shown above.'}
      </p>
    </div>
  );
}
