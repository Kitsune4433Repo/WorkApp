import { useState } from 'react';

export interface LatLng {
  lat: number;
  lng: number;
}

interface Props {
  address: string;
  onAddressChange: (address: string) => void;
  siteLocation: LatLng | null;
  polygon: LatLng[];
  onSiteLocationChange: (location: LatLng) => void;
  onPolygonChange: (polygon: LatLng[]) => void;
}

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

/** Site-address controls for the shared dispatch map (web/src/components/JobsMap.tsx) — this
 * component no longer renders its own map; typing an address and finding it (or clicking the
 * shared map directly) both update the same siteLocation/polygon state the map is drawing from, so
 * there's one map on the page instead of a separate picker map layered under the create-job form. */
export function GeofenceMapPicker({ address, onAddressChange, polygon, onSiteLocationChange, onPolygonChange }: Props) {
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
        <p className="text-xs text-slate-500">
          Click the highlighted job's spot on the map above to draw a geofence perimeter ({polygon.length} pt{polygon.length === 1 ? '' : 's'}).
        </p>
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
      <p className="text-xs text-slate-500">
        {polygon.length >= 3
          ? 'Drawn geofence will be used (takes precedence over the radius fallback).'
          : polygon.length > 0
            ? 'Need at least 3 points to form a geofence — keep clicking, or clear to fall back to the radius.'
            : 'No polygon drawn — falls back to the radius circle shown on the map.'}
      </p>
    </div>
  );
}
