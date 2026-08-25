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

type Tool = 'pen' | 'highlighter' | 'pan';

const DEFAULT_SIZE: Record<'pen' | 'highlighter', number> = { pen: 3, highlighter: 14 };
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

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
  description?: string | null;
  // null while the signed URL is still loading — the viewer opens immediately on click rather than
  // waiting on that round trip first, so this covers the brief gap (or longer, on a slow
  // connection) between "the user tapped an image" and "we actually have something to show".
  imageUrl: string | null;
  currentUserId: string;
  onClose: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  position?: { index: number; total: number };
}

// A drag has to clear both of these to count as "swipe to the next/previous image" rather than
// "the user nudged the pan a little" — distance is the primary signal, but a slow, long drag (e.g.
// someone carefully panning around a zoomed photo) is deliberately excluded by the velocity check.
const SWIPE_MIN_DISTANCE_PX = 80;
const SWIPE_MAX_DURATION_MS = 600;

/** Freehand draw/highlight overlay on an uploaded image — reuses the map_annotations backend built
 * for the Android map-redlining feature (PUT/GET /documents/:id/annotations); each user has their
 * own annotation layer on the same image, with the same offline-conflict versioning as that feature. */
export function ImageAnnotationViewer({
  documentId,
  documentVersion,
  title,
  description,
  imageUrl,
  currentUserId,
  onClose,
  onNext,
  onPrev,
  position,
}: Props) {
  const queryClient = useQueryClient();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef(false);
  const panRef = useRef<{ x: number; y: number; panX: number; panY: number; startedAt: number } | null>(null);

  const [tool, setToolState] = useState<Tool>('pen');
  const [size, setSize] = useState(DEFAULT_SIZE.pen);
  const [color, setColor] = useState('#dc2626');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [serverVersion, setServerVersion] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  function selectTool(t: 'pen' | 'highlighter') {
    setToolState(t);
    setSize(DEFAULT_SIZE[t]);
  }

  // Resets only the per-image state (this document's strokes/version, its own load/error status,
  // and the view) — NOT tool/color/size, which are drawing preferences that should carry over as
  // you move through the gallery. This runs instead of remounting the whole component on document
  // change, since a remount was resetting the active tool back to "Draw" every time, which broke
  // swipe-to-navigate (swiping only works in "Pan" mode — see onPointerUp below) after one use.
  useEffect(() => {
    setStrokes([]);
    setServerVersion(0);
    setLoaded(false);
    setImageError(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [documentId]);

  const { data: layers } = useQuery<AnnotationLayer[]>({
    queryKey: ['documents', documentId, 'annotations'],
    queryFn: async () => (await api.get(`/documents/${documentId}/annotations`)).data,
  });

  useEffect(() => {
    if (!layers || loaded) return;
    const mine = layers.find((l) => l.created_by === currentUserId);
    if (mine) {
      setStrokes(mine.layer_data?.strokes ?? []);
      // node-pg returns the BIGINT version column as a string over JSON — without coercing this,
      // the *next* save sends clientVersion as a string, which fails validation (400) until the
      // whole page is reloaded and this component's state starts fresh from 0 again.
      setServerVersion(Number(mine.version));
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
  // silently ending up 0x0 and undrawable. Zoom/pan are applied as a CSS transform on this same
  // wrapper, so the canvas's own resolution (and therefore stroke coordinates, which are stored
  // normalized 0-1) never needs to change — getBoundingClientRect() already reflects the transform,
  // so pointFromEvent's math below is correct at any zoom/pan without extra work.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const observer = new ResizeObserver(() => redraw());
    observer.observe(wrapper);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Desktop shortcut for the same navigation the arrow buttons/swipe give touch users — skipped
  // while a color/range input has focus so arrow-key nudges there (e.g. the size slider) aren't
  // hijacked into changing images.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const activeTag = (document.activeElement as HTMLElement | null)?.tagName;
      if (activeTag === 'INPUT') return;
      if (e.key === 'ArrowRight' && onNext) onNext();
      else if (e.key === 'ArrowLeft' && onPrev) onPrev();
      else if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onNext, onPrev, onClose]);

  function pointFromEvent(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === 'pan') {
      panRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y, startedAt: Date.now() };
      return;
    }
    drawingRef.current = true;
    // Read everything off the synthetic event synchronously here — React can invoke a functional
    // state-updater more than once (e.g. Strict Mode's double-invoke), and by a second call the
    // pooled event's currentTarget is no longer valid, which crashed this on the very first stroke.
    const point = pointFromEvent(e);
    const newStroke: Stroke = { type: tool, color, width: size, points: [point], ts: Date.now() };
    setStrokes((s) => [...s, newStroke]);
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (panRef.current) {
      const { x, y, panX, panY } = panRef.current;
      setPan({ x: panX + (e.clientX - x), y: panY + (e.clientY - y) });
      return;
    }
    if (!drawingRef.current) return;
    const point = pointFromEvent(e);
    setStrokes((s) => {
      const next = [...s];
      const last = next[next.length - 1];
      next[next.length - 1] = { ...last, points: [...last.points, point] };
      return next;
    });
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    drawingRef.current = false;
    // At the default 1x "fit" zoom, dragging in pan mode doesn't reveal anything a pan couldn't
    // already show (the whole image is already on screen) — so repurpose a fast, mostly-horizontal
    // drag there as swipe-to-navigate instead. Once actually zoomed in, panning is doing real work
    // (looking around a magnified image), so it's left alone — swipe-nav only ever fires at 1x.
    if (panRef.current && zoom === MIN_ZOOM && (onNext || onPrev)) {
      const dx = e.clientX - panRef.current.x;
      const dy = e.clientY - panRef.current.y;
      const duration = Date.now() - panRef.current.startedAt;
      if (Math.abs(dx) >= SWIPE_MIN_DISTANCE_PX && Math.abs(dx) > Math.abs(dy) * 1.5 && duration <= SWIPE_MAX_DURATION_MS) {
        setPan({ x: 0, y: 0 });
        if (dx < 0) onNext?.();
        else onPrev?.();
      }
    }
    panRef.current = null;
  }

  function zoomBy(delta: number) {
    setZoom((z) => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, +(z + delta).toFixed(2)));
      if (next === MIN_ZOOM) setPan({ x: 0, y: 0 });
      return next;
    });
  }

  const toolButtonClass = (active: boolean) => `rounded-md px-3 py-1.5 text-sm font-medium ${active ? 'bg-brand-600 text-white' : 'border border-slate-300 text-slate-600'}`;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/80 p-2 md:p-4">
      <div className="rounded-t-lg bg-white px-3 py-3 md:px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold text-slate-900">
            {title}
            {position && <span className="ml-2 font-normal text-slate-400">{position.index + 1} / {position.total}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => selectTool('pen')} className={toolButtonClass(tool === 'pen')}>
              Draw
            </button>
            <button onClick={() => selectTool('highlighter')} className={toolButtonClass(tool === 'highlighter')}>
              Highlight
            </button>
            <button onClick={() => setToolState('pan')} className={toolButtonClass(tool === 'pan')} title="Move the image without drawing">
              Pan
            </button>

            {tool !== 'pan' && (
              <label className="flex items-center gap-1.5 text-xs text-slate-500">
                Size
                <input type="range" min={1} max={40} value={size} onChange={(e) => setSize(Number(e.target.value))} className="w-20 accent-brand-600" />
                <span className="w-5 text-right font-mono">{size}</span>
              </label>
            )}

            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-8 w-8 cursor-pointer rounded-md border border-slate-300 p-0.5"
              aria-label="Stroke color"
              title="Choose a color"
            />

            <div className="flex items-center gap-1 rounded-md border border-slate-300 px-1">
              <button onClick={() => zoomBy(-0.25)} disabled={zoom <= MIN_ZOOM} className="px-2 py-1 text-sm text-slate-600 disabled:opacity-30">
                −
              </button>
              <span className="w-10 text-center font-mono text-xs text-slate-500">{Math.round(zoom * 100)}%</span>
              <button onClick={() => zoomBy(0.25)} disabled={zoom >= MAX_ZOOM} className="px-2 py-1 text-sm text-slate-600 disabled:opacity-30">
                +
              </button>
            </div>

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
        {description && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-500">{description}</p>}
      </div>
      {saveMutation.isError && (
        <p className="bg-red-50 px-4 py-2 text-sm text-red-700">
          Failed to save — someone else may have annotated this image since you opened it. Close and reopen to see their changes.
        </p>
      )}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-slate-900">
        {onPrev && (
          <button
            onClick={onPrev}
            aria-label="Previous image"
            className="absolute left-1 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/40 p-3 text-2xl text-white hover:bg-black/60 md:left-3"
          >
            ‹
          </button>
        )}
        {onNext && (
          <button
            onClick={onNext}
            aria-label="Next image"
            className="absolute right-1 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/40 p-3 text-2xl text-white hover:bg-black/60 md:right-3"
          >
            ›
          </button>
        )}
        <div
          className="relative inline-block min-h-[60vh] min-w-[60vw]"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: 'center center' }}
        >
          <div ref={wrapperRef} className="relative inline-block">
            {imageError ? (
              <div className="flex h-[60vh] w-[60vw] items-center justify-center text-sm text-slate-400">Image failed to load.</div>
            ) : imageUrl === null ? (
              <div className="flex h-[60vh] w-[60vw] items-center justify-center">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-600 border-t-white" aria-label="Loading image" />
              </div>
            ) : (
              <img src={imageUrl} alt={title} onLoad={redraw} onError={() => setImageError(true)} className="max-h-[80vh] max-w-full select-none" draggable={false} />
            )}
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
              className={`absolute left-0 top-0 h-full w-full touch-none ${tool === 'pan' ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'}`}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
