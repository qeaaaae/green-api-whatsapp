import { describe, expect, it } from 'vitest';
import { lonLatToWorld, tilesCovering, tileUrl } from './geo';

describe('lonLatToWorld', () => {
  it('нулевые координаты - центр мира', () => {
    // на зуме 1 мир = 512px, экватор/нулевой меридиан - ровно центр
    const { x, y } = lonLatToWorld(0, 0, 1);
    expect(x).toBe(256);
    expect(y).toBeCloseTo(256);
  });

  it('известная точка: Москва на зуме 15', () => {
    // lon=37.6176, lat=55.7558 -> тайл 19808/10243 (slippy map)
    const { x, y } = lonLatToWorld(37.6176, 55.7558, 15);
    expect(Math.floor(x / 256)).toBe(19808);
    expect(Math.floor(y / 256)).toBe(10243);
  });
});

describe('tilesCovering', () => {
  it('точка отрисовывается ровно в центре вьюпорта', () => {
    const tiles = tilesCovering(55.7558, 37.6176, 15, 320, 150);
    // экранная позиция точки всегда центр контейнера (160, 75) -
    // и ровно один тайл покрывает эту позицию
    const covering = tiles.filter(
      (t) => t.left <= 160 && 160 <= t.left + 256 && t.top <= 75 && 75 <= t.top + 256,
    );
    expect(covering).toHaveLength(1);
  });

  it('тайлы полностью покрывают вьюпорт', () => {
    const tiles = tilesCovering(0, 0, 15, 320, 150);
    const minLeft = Math.min(...tiles.map((t) => t.left));
    const maxRight = Math.max(...tiles.map((t) => t.left + 256));
    const minTop = Math.min(...tiles.map((t) => t.top));
    const maxBottom = Math.max(...tiles.map((t) => t.top + 256));
    expect(minLeft).toBeLessThanOrEqual(0);
    expect(minTop).toBeLessThanOrEqual(0);
    expect(maxRight).toBeGreaterThanOrEqual(320);
    expect(maxBottom).toBeGreaterThanOrEqual(150);
  });
});

describe('tileUrl', () => {
  it('собирает URL тайла OSM', () => {
    expect(tileUrl(1, 2, 15)).toBe('https://tile.openstreetmap.org/15/1/2.png');
  });
});
