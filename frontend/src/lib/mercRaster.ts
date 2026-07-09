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

/** Raw texel fetch — longitude wraps (the grid is a full 360° band), latitude
 * clamps at the poles (no wraparound there). */
function texel(layer: RasterLayer, i: number, j: number): [number, number, number, number] {
  const jc = Math.max(0, Math.min(layer.height - 1, j));
  const ic = ((i % layer.width) + layer.width) % layer.width;
  const o = (jc * layer.width + ic) * 4;
  const d = layer.imageData.data;
  return [d[o], d[o + 1], d[o + 2], d[o + 3]];
}

/** Sample a raster layer at (lat, lon), bilinearly blending the 4 nearest
 * texels — the canvas renderers (Globe/Beam) inverse-project every screen
 * pixel through this, so flooring to one texel (the old behavior) showed up
 * as hard concentric rings on anything with a smooth gradient, like the
 * coverage glow around DE. Blends in premultiplied-alpha space so a fully
 * transparent neighbor's arbitrary RGB never bleeds a dark fringe into a
 * partially-opaque edge. Null outside the ±85° band or when the blended
 * result is still fully transparent. */
export function sampleRaster(
  layer: RasterLayer,
  lat: number,
  lon: number,
): [number, number, number, number] | null {
  if (lat < -RASTER_MAX_LAT || lat > RASTER_MAX_LAT) return null;
  const yTop = mercY(RASTER_MAX_LAT);
  const ySpan = 2 * yTop;
  const y = mercY(lat);
  // Continuous texel coordinates, shifted by half a pixel so integer values
  // land on texel centers (row/col k's center is at (k+0.5)/size — see
  // coverage.ts et al.), matching how every raster here was written.
  const fj = ((yTop - y) / ySpan) * layer.height - 0.5;
  const lonN = (((lon + 180) % 360) + 360) % 360;
  const fi = (lonN / 360) * layer.width - 0.5;

  const i0 = Math.floor(fi);
  const j0 = Math.floor(fj);
  const tx = fi - i0;
  const ty = fj - j0;

  let pr = 0, pg = 0, pb = 0, pa = 0;
  for (const [di, dj, w] of [
    [0, 0, (1 - tx) * (1 - ty)],
    [1, 0, tx * (1 - ty)],
    [0, 1, (1 - tx) * ty],
    [1, 1, tx * ty],
  ] as const) {
    const [r, g, b, a] = texel(layer, i0 + di, j0 + dj);
    const wa = w * a;
    pr += r * wa;
    pg += g * wa;
    pb += b * wa;
    pa += wa;
  }
  if (pa < 0.5) return null;
  return [Math.round(pr / pa), Math.round(pg / pa), Math.round(pb / pa), Math.round(pa)];
}
