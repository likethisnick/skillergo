import { CONFIG } from '@skillergo/shared';

/**
 * Keeps the local player in the screen center.
 * Zoom is chosen so the visible *area* matches CONFIG.view on any screen shape,
 * so a phone in portrait sees roughly as much of the world as a wide monitor.
 */
export class Camera {
  x = 0;
  y = 0;
  scale = 1;
  width = 0;
  height = 0;

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.scale = Math.sqrt((width * height) / (CONFIG.view.width * CONFIG.view.height));
  }

  follow(x: number, y: number): void {
    this.x = x;
    this.y = y;
  }

  worldToScreen(x: number, y: number): { x: number; y: number } {
    return {
      x: (x - this.x) * this.scale + this.width / 2,
      y: (y - this.y) * this.scale + this.height / 2,
    };
  }

  /** Visible world rectangle. */
  bounds(): { left: number; top: number; right: number; bottom: number } {
    const halfW = this.width / 2 / this.scale;
    const halfH = this.height / 2 / this.scale;
    return { left: this.x - halfW, top: this.y - halfH, right: this.x + halfW, bottom: this.y + halfH };
  }
}
