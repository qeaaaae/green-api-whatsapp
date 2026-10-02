// Тайловая математика slippy map (OpenStreetMap/Google-нотация):
// координаты -> мировые пиксели на заданном зуме -> список тайлов для вьюпорта
const TILE_SIZE = 256;

export function lonLatToWorld(lon: number, lat: number, zoom: number) {
  const clamped = Math.max(-85.0511, Math.min(85.0511, lat));
  const scale = TILE_SIZE * 2 ** zoom;
  const x = ((lon + 180) / 360) * scale;
  const rad = (clamped * Math.PI) / 180;
  const y =
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * scale;
  return { x, y };
}

export interface TilePlacement {
  x: number;
  y: number;
  left: number;
  top: number;
}

// Тайлы, покрывающие прямоугольник width x height, отцентрованный на точке
export function tilesCovering(
  lat: number,
  lon: number,
  zoom: number,
  width: number,
  height: number,
): TilePlacement[] {
  const center = lonLatToWorld(lon, lat, zoom);
  const originX = center.x - width / 2;
  const originY = center.y - height / 2;
  const max = 2 ** zoom - 1;
  const tiles: TilePlacement[] = [];
  for (
    let tx = Math.floor(originX / TILE_SIZE);
    tx * TILE_SIZE < originX + width;
    tx++
  ) {
    for (
      let ty = Math.floor(originY / TILE_SIZE);
      ty * TILE_SIZE < originY + height;
      ty++
    ) {
      // За полюсами тайлов нет, по горизонтали мир заворачивается
      if (ty < 0 || ty > max) continue;
      tiles.push({
        x: ((tx % (max + 1)) + max + 1) % (max + 1),
        y: ty,
        left: Math.round(tx * TILE_SIZE - originX),
        top: Math.round(ty * TILE_SIZE - originY),
      });
    }
  }
  return tiles;
}

export function tileUrl(x: number, y: number, zoom: number) {
  return `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;
}
