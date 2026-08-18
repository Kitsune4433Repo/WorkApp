import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import 'leaflet/dist/leaflet.css';

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

export interface MapJob {
  id: string;
  job_number: string;
  title: string;
  priority: string;
  is_active: boolean;
  lat: number | null;
  lng: number | null;
}

// Memphis, TN — dispatch center default.
const DEFAULT_CENTER: [number, number] = [35.1495, -90.049];

function FitToMarkers({ jobs }: { jobs: MapJob[] }) {
  const map = useMap();
  useEffect(() => {
    const located = jobs.filter((j): j is MapJob & { lat: number; lng: number } => j.lat != null && j.lng != null);
    if (!located.length) return;
    if (located.length === 1) {
      map.setView([located[0].lat, located[0].lng], 13);
    } else {
      map.fitBounds(located.map((j) => [j.lat, j.lng] as [number, number]), { padding: [30, 30] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs.map((j) => `${j.id}:${j.lat}:${j.lng}`).join(',')]);
  return null;
}

/** Read-only overview map for the dispatch board — every job with a site location shown as a pin,
 * so a dispatcher can see the whole week's work geographically instead of just as table rows. */
export function JobsMap({ jobs }: { jobs: MapJob[] }) {
  const located = jobs.filter((j) => j.lat != null && j.lng != null);

  return (
    <div className="h-80 overflow-hidden rounded-lg border border-slate-200">
      <MapContainer center={DEFAULT_CENTER} zoom={11} className="h-full w-full">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitToMarkers jobs={located} />
        {located.map((job) => (
          <Marker key={job.id} position={[job.lat as number, job.lng as number]}>
            <Popup>
              <div className="space-y-1 text-sm">
                <div className="font-semibold">{job.job_number}</div>
                <div>{job.title}</div>
                <div className="text-xs text-slate-500 capitalize">
                  {job.priority} priority &middot; {job.is_active ? 'Active' : 'Inactive'}
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
