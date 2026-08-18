import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  type: 'pen' | 'highlighter';
  points: Point[];
  color: string;
  width: number;
  ts: number;
}

interface AnnotationLayer {
  created_by: string;
  layer_data: { strokes: Stroke[] };
  version: number;
  updated_at: string;
}

const COLORS = ['#dc2626', '#2563eb', '#16a34a', '#000000'];

// A stable per-browser id, distinct from the shared web-portal X-Device-Id header — matches the
// clientId the backend's offline-sync conflict detection expects to distinguish devices.
function getClientId(): string {
  const key = 'annotation-client-id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

interface Props {
  documentId: string;
  documentVersion: number;
  title: string;
  imageUrl: string;
  currentUserId: string;
  onClose: () => void;
}

/** Freehand draw/highlight overlay on an uploaded image — reuses the map_annotations backend built
 * for the Android map-redlining feature (PUT/GET /documents/:id/annotations); each user has their
 * own annotation layer on the same image, with the same offline-conflict versioning as that feature. */
export function ImageAnnotationViewer({ documentId, documentVersion, title, imageUrl, currentUserId, onClose }: Props) {
  const queryClient = useQueryClient();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef(false);

  const [tool, setTool] = useState<'pen' | 'highlighter'>('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [serverVersion, setServerVersion] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  const { data: layers } = useQuery<AnnotationLayer[]>({
    queryKey: ['documents', documentId, 'annotations'],
    queryFn: async () => (await api.get(`/documents/${documentId}/annotations`)).data,
  });

  useEffect(() => {
    if (!layers || loaded) return;
    const mine = layers.find((l) => l.created_by === currentUserId);
    if (mine) {
      setStrokes(mine.layer_data?.strokes ?? []);
      setServerVersion(mine.version);
    }
    setLoaded(true);
  }, [layers, loaded, currentUserId]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.put(`/documents/${documentId}/annotations`, {
        documentVersion,
        layerData: { strokes },
        clientVersion: serverVersion,
        clientId: getClientId(),
      }),
    onSuccess: () => {
      setServerVersion((v) => v + 1);
      queryClient.invalidateQueries({ queryKey: ['documents', documentId, 'annotations'] });
    },
  });

  function redraw() {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;
    canvas.width = wrapper.clientWidth;
    canvas.height = wrapper.clientHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx || !canvas.width || !canvas.height) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const stroke of strokes) {
      if (stroke.points.length < 2) continue;
      ctx.globalAlpha = stroke.type === 'highlighter' ? 0.35 : 1;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x * canvas.width, stroke.points[0].y * canvas.height);
      for (const p of stroke.points.slice(1)) ctx.lineTo(p.x * canvas.width, p.y * canvas.height);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  useEffect(redraw, [strokes]);

  // The canvas is sized off the wrapper div (not the <img> directly) so drawing still works — sized
  // to a sane placeholder box — even if the image itself is slow or fails to load, rather than
  // silently ending up 0x0 and undrawable.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const observer = new ResizeObserver(() => redraw());
    observer.observe(wrapper);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pointFromEvent(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    // Read everything off the synthetic event synchronously here — React can invoke a functional
    // state-updater more than once (e.g. Strict Mode's double-invoke), and by a second call the
    // pooled event's currentTarget is no longer valid, which crashed this on the very first stroke.
    const point = pointFromEvent(e);
    const newStroke: Stroke = { type: tool, color, width: tool === 'highlighter' ? 14 : 3, points: [point], ts: Date.now() };
    setStrokes((s) => [...s, newStroke]);
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const point = pointFromEvent(e);
    setStrokes((s) => {
      const next = [...s];
      const last = next[next.length - 1];
      next[next.length - 1] = { ...last, points: [...last.points, point] };
      return next;
    });
  }

  function onPointerUp() {
    drawingRef.current = false;
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/80 p-4">
      <div className="flex items-center justify-between rounded-t-lg bg-white px-4 py-3">
        <div className="font-semibold text-slate-900">{title}</div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTool('pen')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${tool === 'pen' ? 'bg-brand-600 text-white' : 'border border-slate-300 text-slate-600'}`}
          >
            Draw
          </button>
          <button
            onClick={() => setTool('highlighter')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${tool === 'highlighter' ? 'bg-brand-600 text-white' : 'border border-slate-300 text-slate-600'}`}
          >
            Highlight
          </button>
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              style={{ backgroundColor: c }}
              className={`h-6 w-6 rounded-full border-2 ${color === c ? 'border-slate-900' : 'border-white'}`}
              aria-label={`Color ${c}`}
            />
          ))}
          <button
            onClick={() => setStrokes((s) => s.slice(0, -1))}
            disabled={!strokes.length}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 disabled:opacity-40"
          >
            Undo
          </button>
          <button onClick={() => setStrokes([])} disabled={!strokes.length} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 disabled:opacity-40">
            Clear
          </button>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
          >
            {saveMutation.isPending ? 'Saving…' : 'Save'}
          </button>
          <button onClick={onClose} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600">
            Close
          </button>
        </div>
      </div>
      {saveMutation.isError && (
        <p className="bg-red-50 px-4 py-2 text-sm text-red-700">
          Failed to save — someone else may have annotated this image since you opened it. Close and reopen to see their changes.
        </p>
      )}
      <div className="relative flex flex-1 items-center justify-center overflow-auto bg-slate-900">
        <div ref={wrapperRef} className="relative inline-block min-h-[60vh] min-w-[60vw]">
          {imageError ? (
            <div className="flex h-[60vh] w-[60vw] items-center justify-center text-sm text-slate-400">Image failed to load.</div>
          ) : (
            <img src={imageUrl} alt={title} onLoad={redraw} onError={() => setImageError(true)} className="max-h-[80vh] max-w-full select-none" draggable={false} />
          )}
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            className="absolute left-0 top-0 h-full w-full touch-none"
          />
        </div>
      </div>
    </div>
  );
}
