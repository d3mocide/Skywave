// Shared plumbing for the Mercator-projected raster overlays (coverage,
// aurora OVATION, MUF field, blackout). All four share the same ±85°
// Mercator-Y row spacing — required so a Leaflet ImageOverlay stretches
// correctly — and now the same pixel format, so GlobeMap can sample any of
// them through one inverse-projection helper instead of four bespoke ones.

export const RASTER_MAX_LAT = 85;

export function mercY(latDeg: number): number {
  const φ = (latDeg * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + φ / 2));
}

export interface RasterLayer {
  /** PNG data URL for Leaflet's ImageOverlay (WorldMap / Flat view). */
  url: string;
  /** Same pixel data, for the globe's inverse-projection sampler. */
  imageData: ImageData;
  width: number;
  height: number;
}

export function finishRaster(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  img: ImageData,
): RasterLayer {
  ctx.putImageData(img, 0, 0);
  return { url: canvas.toDataURL('image/png'), imageData: img, width: canvas.width, height: canvas.height };
}

/** Sample a raster layer at (lat, lon). Null outside the ±85° band or on a
 * fully-transparent texel — same "nothing there" meaning either way. */
export function sampleRaster(
  layer: RasterLayer,
  lat: number,
  lon: number,
): [number, number, number, number] | null {
  if (lat < -RASTER_MAX_LAT || lat > RASTER_MAX_LAT) return null;
  const yTop = mercY(RASTER_MAX_LAT);
  const ySpan = 2 * yTop;
  const y = mercY(lat);
  const j = Math.floor(((yTop - y) / ySpan) * layer.height);
  const lonN = (((lon + 180) % 360) + 360) % 360;
  const i = Math.floor((lonN / 360) * layer.width);
  if (j < 0 || j >= layer.height || i < 0 || i >= layer.width) return null;
  const o = (j * layer.width + i) * 4;
  const d = layer.imageData.data;
  const a = d[o + 3];
  if (a === 0) return null;
  return [d[o], d[o + 1], d[o + 2], a];
}
