import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Circle, Polygon, useMap, useMapEvents } from 'react-leaflet';
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

interface Props {
  address: string;
  onAddressChange: (address: string) => void;
  siteLocation: LatLng | null;
  radiusM: number;
  polygon: LatLng[];
  onSiteLocationChange: (location: LatLng) => void;
  onPolygonChange: (polygon: LatLng[]) => void;
}

// Memphis, TN — dispatch center default.
const DEFAULT_CENTER: LatLng = { lat: 35.1495, lng: -90.049 };

// Nominatim (OpenStreetMap's free geocoder) — fine for this volume of lookups; see usage policy at
// https://operations.osmfoundation.org/policies/nominatim/. Browsers can't set a custom
// User-Agent, but Nominatim accepts the browser-supplied Referer as identification for light use.
async function geocodeAddress(address: string): Promise<LatLng | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const results = (await res.json()) as { lat: string; lon: string }[];
  if (!results.length) return null;
  return { lat: Number(results[0].lat), lng: Number(results[0].lon) };
}

function ClickHandler({ onPick }: { onPick: (p: LatLng) => void }) {
  useMapEvents({
    click(e) {
      onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

// MapContainer's `center` prop only sets the *initial* view — it doesn't move the map when the
// prop changes later (e.g. after a geocode result comes in), so panning has to happen imperatively.
// Only re-centers when the location itself changes (not on every render — the polygon-drawing
// clicks re-render this component too, and shouldn't reset the user's pan/zoom mid-draw).
function RecenterOnChange({ location }: { location: LatLng | null }) {
  const map = useMap();
  useEffect(() => {
    if (location) map.setView(location, 17);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location?.lat, location?.lng]);
  return null;
}

/** Site location comes from a typed address (geocoded via Nominatim); clicking the map draws the
 * geofence perimeter instead — the backend (jobs.polygonToWkt / fn_point_in_job_geofence) has
 * always supported a drawn polygon, the web UI just never exposed it. */
export function GeofenceMapPicker({ address, onAddressChange, siteLocation, radiusM, polygon, onSiteLocationChange, onPolygonChange }: Props) {
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);

  async function handleFindAddress() {
    if (!address.trim()) return;
    setGeocoding(true);
    setGeocodeError(null);
    try {
      const location = await geocodeAddress(address.trim());
      if (location) onSiteLocationChange(location);
      else setGeocodeError("Couldn't find that address — try adding city/state, or click the map directly.");
    } catch {
      setGeocodeError('Address lookup failed. Try again, or click the map directly.');
    } finally {
      setGeocoding(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          value={address}
          onChange={(e) => onAddressChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleFindAddress();
            }
          }}
          placeholder="Site address (e.g. 142 Elm St, Memphis, TN)"
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={handleFindAddress}
          disabled={geocoding}
          className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {geocoding ? 'Finding…' : 'Find on map'}
        </button>
      </div>
      {geocodeError && <p className="text-xs text-red-600">{geocodeError}</p>}

      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">Click the map to draw a geofence perimeter ({polygon.length} pt{polygon.length === 1 ? '' : 's'}).</p>
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
        <MapContainer center={siteLocation ?? DEFAULT_CENTER} zoom={siteLocation ? 17 : 11} className="h-full w-full">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <RecenterOnChange location={siteLocation} />
          <ClickHandler onPick={(p) => onPolygonChange([...polygon, p])} />
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
