"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from "react";

export type PickedLocation = {
  latitude: number;
  longitude: number;
};

type LocationPickerDialogProps = {
  open: boolean;
  isKhmer?: boolean;
  initialLocation?: PickedLocation | null;
  onClose: () => void;
  onConfirm: (location: PickedLocation) => void;
};

type MapSize = {
  width: number;
  height: number;
};

type MapPoint = {
  x: number;
  y: number;
};

type Tile = {
  key: string;
  x: number;
  y: number;
  left: number;
  top: number;
  url: string;
};

const TILE_SIZE = 256;
const MIN_ZOOM = 2;
const MAX_ZOOM = 18;
const MAX_MERCATOR_LAT = 85.05112878;

function clampLatitude(latitude: number) {
  return Math.max(
    -MAX_MERCATOR_LAT,
    Math.min(MAX_MERCATOR_LAT, latitude),
  );
}

function normalizeLongitude(longitude: number) {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

function worldSizeForZoom(zoom: number) {
  return TILE_SIZE * 2 ** zoom;
}

function projectLocation(
  location: PickedLocation,
  zoom: number,
): MapPoint {
  const latitude = clampLatitude(location.latitude);
  const longitude = normalizeLongitude(location.longitude);
  const worldSize = worldSizeForZoom(zoom);
  const latitudeRadians = (latitude * Math.PI) / 180;
  const sinLatitude = Math.sin(latitudeRadians);

  return {
    x: ((longitude + 180) / 360) * worldSize,
    y:
      (0.5 -
        Math.log((1 + sinLatitude) / (1 - sinLatitude)) /
          (4 * Math.PI)) *
      worldSize,
  };
}

function unprojectPoint(
  point: MapPoint,
  zoom: number,
): PickedLocation {
  const worldSize = worldSizeForZoom(zoom);
  const wrappedX = ((point.x % worldSize) + worldSize) % worldSize;
  const clampedY = Math.max(0, Math.min(worldSize, point.y));
  const longitude = (wrappedX / worldSize) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * clampedY) / worldSize;
  const latitude =
    (180 / Math.PI) * Math.atan(Math.sinh(n));

  return {
    latitude: clampLatitude(latitude),
    longitude: normalizeLongitude(longitude),
  };
}

function buildTiles(
  center: PickedLocation,
  zoom: number,
  size: MapSize,
) {
  if (size.width <= 0 || size.height <= 0) {
    return [] as Tile[];
  }

  const tileCount = 2 ** zoom;
  const centerPoint = projectLocation(center, zoom);
  const topLeftX = centerPoint.x - size.width / 2;
  const topLeftY = centerPoint.y - size.height / 2;
  const minTileX = Math.floor(topLeftX / TILE_SIZE) - 1;
  const maxTileX = Math.floor((topLeftX + size.width) / TILE_SIZE) + 1;
  const minTileY = Math.max(0, Math.floor(topLeftY / TILE_SIZE) - 1);
  const maxTileY = Math.min(
    tileCount - 1,
    Math.floor((topLeftY + size.height) / TILE_SIZE) + 1,
  );
  const tiles: Tile[] = [];

  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const wrappedTileX = ((tileX % tileCount) + tileCount) % tileCount;
      tiles.push({
        key: `${tileX}:${tileY}`,
        x: tileX,
        y: tileY,
        left: tileX * TILE_SIZE - topLeftX,
        top: tileY * TILE_SIZE - topLeftY,
        url: `https://tile.openstreetmap.org/${zoom}/${wrappedTileX}/${tileY}.png`,
      });
    }
  }

  return tiles;
}

function getMarkerPosition(
  center: PickedLocation,
  selected: PickedLocation | null,
  zoom: number,
  size: MapSize,
) {
  if (!selected || size.width <= 0 || size.height <= 0) {
    return null;
  }

  const worldSize = worldSizeForZoom(zoom);
  const centerPoint = projectLocation(center, zoom);
  const selectedPoint = projectLocation(selected, zoom);
  let deltaX = selectedPoint.x - centerPoint.x;

  if (deltaX > worldSize / 2) {
    deltaX -= worldSize;
  } else if (deltaX < -worldSize / 2) {
    deltaX += worldSize;
  }

  return {
    left: size.width / 2 + deltaX,
    top: size.height / 2 + (selectedPoint.y - centerPoint.y),
  };
}

function formatCoordinate(value: number) {
  return Number.isFinite(value) ? value.toFixed(6) : "0.000000";
}

export function LocationPickerDialog({
  open,
  isKhmer = false,
  initialLocation = null,
  onClose,
  onConfirm,
}: LocationPickerDialogProps) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const ignoreNextClickRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startCenter: MapPoint;
    moved: boolean;
  } | null>(null);

  const [mapSize, setMapSize] = useState<MapSize>({
    width: 0,
    height: 280,
  });
  const [zoom, setZoom] = useState(
    initialLocation ? 15 : MIN_ZOOM,
  );
  const [center, setCenter] = useState<PickedLocation>(
    initialLocation ?? {
      latitude: 0,
      longitude: 0,
    },
  );
  const [selected, setSelected] = useState<PickedLocation | null>(
    initialLocation,
  );
  const [gettingCurrentLocation, setGettingCurrentLocation] =
    useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const next = initialLocation ?? {
      latitude: 0,
      longitude: 0,
    };
    setCenter(next);
    setSelected(initialLocation);
    setZoom(initialLocation ? 15 : MIN_ZOOM);
    setLocationError(null);
  }, [initialLocation, open]);

  useEffect(() => {
    if (!open || !mapRef.current) {
      return;
    }

    const element = mapRef.current;
    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setMapSize({
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
      });
    };

    updateSize();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateSize);
      return () => window.removeEventListener("resize", updateSize);
    }

    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose, open]);

  const tiles = useMemo(
    () => buildTiles(center, zoom, mapSize),
    [center, mapSize, zoom],
  );
  const markerPosition = useMemo(
    () => getMarkerPosition(center, selected, zoom, mapSize),
    [center, mapSize, selected, zoom],
  );

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setLocationError(
        isKhmer
          ? "កម្មវិធីរុករកនេះមិនគាំទ្រទីតាំងទេ។"
          : "Location is not supported by this browser.",
      );
      return;
    }

    setGettingCurrentLocation(true);
    setLocationError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        setCenter(next);
        setSelected(next);
        setZoom((current) => Math.max(current, 15));
        setGettingCurrentLocation(false);
      },
      (error) => {
        setGettingCurrentLocation(false);
        setLocationError(
          error.code === error.PERMISSION_DENIED
            ? isKhmer
              ? "សូមអនុញ្ញាតការចូលប្រើទីតាំងក្នុងកម្មវិធីរុករក។"
              : "Location permission was denied. Please allow location access in your browser."
            : isKhmer
              ? "មិនអាចរកទីតាំងបច្ចុប្បន្នបានទេ។"
              : "Unable to get your current location.",
        );
      },
      {
        enableHighAccuracy: true,
        timeout: 10_000,
        maximumAge: 30_000,
      },
    );
  }

  function handleMapPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startCenter: projectLocation(center, zoom),
      moved: false,
    };
  }

  function handleMapPointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;

    if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) {
      drag.moved = true;
    }

    const nextCenter = unprojectPoint(
      {
        x: drag.startCenter.x - deltaX,
        y: drag.startCenter.y - deltaY,
      },
      zoom,
    );
    setCenter(nextCenter);
  }

  function finishMapPointer(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    ignoreNextClickRef.current = drag.moved;
    dragRef.current = null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleMapClick(event: MouseEvent<HTMLDivElement>) {
    if (ignoreNextClickRef.current) {
      ignoreNextClickRef.current = false;
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const centerPoint = projectLocation(center, zoom);
    const picked = unprojectPoint(
      {
        x: centerPoint.x + (event.clientX - rect.left - rect.width / 2),
        y: centerPoint.y + (event.clientY - rect.top - rect.height / 2),
      },
      zoom,
    );

    setSelected(picked);
    setLocationError(null);
  }

  function adjustZoom(direction: 1 | -1) {
    setZoom((current) =>
      Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, current + direction)),
    );
  }

  if (!open) {
    return null;
  }

  const googleMapsUrl = selected
    ? `https://www.google.com/maps?q=${selected.latitude},${selected.longitude}`
    : null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/40 p-4">
      <button
        type="button"
        aria-label={isKhmer ? "បិទ" : "Close"}
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={isKhmer ? "ជ្រើសរើសទីតាំង" : "Choose location"}
        className="relative z-10 w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">
              {isKhmer ? "ជ្រើសរើសទីតាំង" : "Choose location"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {isKhmer
                ? "ចុចលើផែនទីដើម្បីជ្រើសរើសទីតាំងដែលត្រូវផ្ញើ។"
                : "Click the map to choose the location you want to send."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label={isKhmer ? "បិទ" : "Close"}
          >
            ×
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={useCurrentLocation}
              disabled={gettingCurrentLocation}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
            >
              <span aria-hidden="true">◎</span>
              {gettingCurrentLocation
                ? isKhmer
                  ? "កំពុងរកទីតាំង..."
                  : "Getting location..."
                : isKhmer
                  ? "ប្រើទីតាំងបច្ចុប្បន្ន"
                  : "Use my location"}
            </button>
            <span className="text-xs font-medium text-slate-400">
              {isKhmer ? `កម្រិតពង្រីក ${zoom}` : `Zoom ${zoom}`}
            </span>
          </div>

          <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
            <div
              ref={mapRef}
              onClick={handleMapClick}
              onPointerDown={handleMapPointerDown}
              onPointerMove={handleMapPointerMove}
              onPointerUp={finishMapPointer}
              onPointerCancel={finishMapPointer}
              className="relative h-[280px] w-full cursor-crosshair select-none overflow-hidden bg-slate-100 touch-none"
              aria-label={
                isKhmer
                  ? "ផែនទីជ្រើសរើសទីតាំង"
                  : "Map location picker"
              }
            >
              {tiles.map((tile) => (
                <img
                  key={tile.key}
                  src={tile.url}
                  alt=""
                  draggable={false}
                  className="pointer-events-none absolute h-64 w-64 max-w-none select-none"
                  style={{
                    left: tile.left,
                    top: tile.top,
                  }}
                />
              ))}

              {markerPosition ? (
                <div
                  className="pointer-events-none absolute -translate-x-1/2 -translate-y-full text-[30px] drop-shadow"
                  style={{
                    left: markerPosition.left,
                    top: markerPosition.top,
                  }}
                  aria-hidden="true"
                >
                  📍
                </div>
              ) : null}

              {!selected ? (
                <div className="pointer-events-none absolute inset-x-3 bottom-3 mx-auto w-fit rounded-lg bg-slate-950/75 px-3 py-1.5 text-xs font-medium text-white shadow-sm">
                  {isKhmer ? "ចុចលើផែនទីដើម្បីដាក់សញ្ញា" : "Click the map to drop a pin"}
                </div>
              ) : null}
            </div>

            <div className="absolute right-3 top-3 flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              <button
                type="button"
                onClick={() => adjustZoom(1)}
                disabled={zoom >= MAX_ZOOM}
                className="flex h-9 w-9 items-center justify-center border-b border-slate-200 text-lg font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                aria-label={isKhmer ? "ពង្រីក" : "Zoom in"}
              >
                +
              </button>
              <button
                type="button"
                onClick={() => adjustZoom(-1)}
                disabled={zoom <= MIN_ZOOM}
                className="flex h-9 w-9 items-center justify-center text-lg font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                aria-label={isKhmer ? "បង្រួម" : "Zoom out"}
              >
                −
              </button>
            </div>

            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noreferrer"
              className="absolute bottom-1 right-1 rounded bg-white/90 px-1.5 py-0.5 text-[10px] text-slate-500 hover:text-slate-700"
            >
              © OpenStreetMap contributors
            </a>
          </div>

          {locationError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {locationError}
            </div>
          ) : null}

          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            {selected ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    {isKhmer ? "ទីតាំងដែលបានជ្រើស" : "Selected location"}
                  </div>
                  <div className="mt-1 text-sm font-medium text-slate-700">
                    {formatCoordinate(selected.latitude)}, {formatCoordinate(selected.longitude)}
                  </div>
                </div>
                {googleMapsUrl ? (
                  <a
                    href={googleMapsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-medium text-blue-600 hover:underline"
                  >
                    {isKhmer ? "បើកក្នុង Google Maps ↗" : "Open in Google Maps ↗"}
                  </a>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                {isKhmer
                  ? "មិនទាន់មានទីតាំងត្រូវបានជ្រើសរើស។"
                  : "No location selected yet."}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            {isKhmer ? "បោះបង់" : "Cancel"}
          </button>
          <button
            type="button"
            disabled={!selected}
            onClick={() => {
              if (selected) {
                onConfirm(selected);
              }
            }}
            className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isKhmer ? "បន្ថែមទីតាំង" : "Add location"}
          </button>
        </div>
      </div>
    </div>
  );
}
