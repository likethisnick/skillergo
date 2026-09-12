import { CONFIG } from '@skillergo/shared';

/**
 * Keeps the local player in the screen center.
 * Zoom is chosen so the visible *area* matches the world's view size on any screen shape,
 * so a phone in portrait sees roughly as much of the world as a wide monitor.
 * Versus pulls the camera back, and the marksman sees even more (his weapon shoots farther).
 */
export class Camera {
  x = 0;
  y = 0;
  scale = 1;
  width = 0;
  height = 0;
  private viewWidth: number = CONFIG.view.width;
  private viewHeight: number = CONFIG.view.height;

  /** How much world the player should see. */
  setView(width: number, height: number): void {
    if (width === this.viewWidth && height === this.viewHeight) return;
    this.viewWidth = width;
    this.viewHeight = height;
    this.applyScale();
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.applyScale();
  }

  private applyScale(): void {
    this.scale = Math.sqrt((this.width * this.height) / (this.viewWidth * this.viewHeight));
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
