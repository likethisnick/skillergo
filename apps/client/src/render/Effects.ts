import { CONFIG, type EntityId, type GameEvent, type WorldView } from '@skillergo/shared';
import { UPGRADE_INFO } from '../ui/loadoutInfo';

interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  size: number;
  age: number;
  life: number;
}

interface ConeBlast {
  x: number;
  y: number;
  angle: number;
  range: number;
  arc: number;
  /** Pre-rolled pellet directions and lengths, so the flash does not flicker. */
  pellets: { angle: number; length: number }[];
  age: number;
  life: number;
}

/** Centered screen-space announcement: boss arrival, a picked-up power-up or the match result. */
export interface Banner {
  kind: 'boss' | 'power' | 'tower' | 'result';
  title: string;
  subtitle: string;
  color: string;
  age: number;
  life: number;
}

/** Instant tower shot, drawn as a fading line. */
interface Beam {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  color: string;
  age: number;
  life: number;
}

interface Ring {
  x: number;
  y: number;
  color: string;
  /** Final radius of the expanding ring. */
  radius: number;
  age: number;
  life: number;
}

const POWER_BANNERS = {
  damage: { title: 'DAMAGE x4', color: '#e8590c' },
  attackSpeed: { title: 'ATTACK SPEED x4', color: '#e8590c' },
  speed: { title: 'SPEED x2.5', color: '#1e88e5' },
  wipe: { title: 'WIPE', color: '#7e57c2' },
} as const;

/** Window for the training-room DPS meter. */
const DPS_WINDOW = 3;
/** Minimum seconds between two "cannot damage the nexus" hints. */
const IMMUNE_HINT_INTERVAL = 0.8;

/** Purely visual, client-side effects driven by simulation events. */
export class Effects {
  readonly texts: FloatingText[] = [];
  readonly cones: ConeBlast[] = [];
  readonly rings: Ring[] = [];
  readonly beams: Beam[] = [];
  readonly banners: Banner[] = [];
  private readonly recentHits: { time: number; damage: number }[] = [];
  private clock = 0;
  private lastImmuneHint = -Infinity;

  handle(events: readonly GameEvent[], localPlayerId: EntityId, view: WorldView): void {
    const me = view.players.get(localPlayerId);
    for (const ev of events) {
      switch (ev.type) {
        case 'hit':
          // Only our own damage numbers: in versus mobs fight each other all the time.
          if (ev.sourceId !== localPlayerId) break;
          this.addText(ev.x, ev.y - 40, `-${ev.damage}`, '#e5534b', 18, 0.7);
          this.recentHits.push({ time: this.clock, damage: ev.damage });
          break;
        case 'nexusHit':
        case 'towerHit':
          if (ev.sourceId === localPlayerId && ev.damage >= 5) this.addText(ev.x, ev.y - 40, `-${ev.damage}`, '#b83b34', 22, 0.8);
          break;
        case 'nexusImmune':
          if (ev.sourceId === localPlayerId && this.clock - this.lastImmuneHint > IMMUNE_HINT_INTERVAL) {
            this.lastImmuneHint = this.clock;
            this.addText(ev.x, ev.y - 50, 'Kill the guardian first', '#777777', 20, 1);
          }
          break;
        case 'towerShot':
          this.beams.push({
            x: ev.x, y: ev.y, targetX: ev.targetX, targetY: ev.targetY,
            color: ev.team === 'blue' ? '#4a90e2' : '#e5534b', age: 0, life: 0.18,
          });
          break;
        case 'towerDestroyed': {
          const color = ev.team === 'blue' ? '#2f6fb8' : '#b83b34';
          this.rings.push({ x: ev.x, y: ev.y, color, radius: 220, age: 0, life: 0.7 });
          this.rings.push({ x: ev.x, y: ev.y, color: '#f5b921', radius: ev.blastRadius, age: 0, life: 1.1 });
          const ours = me?.team === ev.team;
          const lane = ev.lane.toUpperCase();
          this.setBanner({
            kind: 'tower',
            title: ours ? 'TOWER LOST' : 'TOWER DESTROYED',
            subtitle: ours
              ? `${lane} lane · the enemy got +1 level · the blast wiped ${ev.wiped} of their mobs`
              : `${lane} lane · +1 level · the blast wiped ${ev.wiped} of our mobs`,
            color: ours ? '#b83b34' : '#2e9e5b',
            age: 0,
            life: 2.6,
          });
          break;
        }
        case 'nexusStage': {
          const ours = me?.team === ev.team;
          this.setBanner({
            kind: 'boss',
            title: ours ? 'OUR NEXUS IS UNDER ATTACK' : 'GUARDIAN SUMMONED',
            subtitle: `${CONFIG.bosses[ev.boss].name} guards the ${ours ? 'base' : 'enemy base'} · stage ${ev.stage} / 3`,
            color: ours ? '#2f6fb8' : '#b83b34',
            age: 0,
            life: 3,
          });
          break;
        }
        case 'victory': {
          const won = me?.team === ev.team;
          this.setBanner({
            kind: 'result',
            title: won ? 'VICTORY' : 'DEFEAT',
            subtitle: ev.reason === 'forfeit'
              ? won ? 'Your opponent left the match' : 'You left the match'
              : won ? 'The enemy nexus has fallen' : 'Your nexus has fallen',
            color: won ? '#2e9e5b' : '#b83b34',
            age: 0,
            life: 4,
          });
          break;
        }
        case 'playerDied': {
          const p = view.players.get(ev.playerId);
          if (!p) break;
          this.rings.push({ x: p.x, y: p.y, color: p.team === 'blue' ? '#2f6fb8' : '#a82f55', radius: 70, age: 0, life: 0.7 });
          if (ev.playerId !== localPlayerId && view.mode === 'versus') {
            this.addText(p.x, p.y - 60, p.isBot ? 'AI SLAIN' : 'SLAIN', '#a82f55', 26, 1.4);
          }
          break;
        }
        case 'playerRespawned': {
          const p = view.players.get(ev.playerId);
          if (p) this.rings.push({ x: p.x, y: p.y, color: '#3cc36b', radius: 60, age: 0, life: 0.6 });
          break;
        }
        case 'playerHit':
          if (ev.playerId === localPlayerId) this.addText(ev.x, ev.y - 50, `-${ev.damage}`, '#c0392b', 20, 0.8);
          break;
        case 'pickup': {
          const p = view.players.get(ev.playerId);
          if (p && ev.playerId === localPlayerId) this.addText(p.x, p.y - 40, `+${ev.xp} XP`, '#2e9e5b', 14, 0.8);
          break;
        }
        case 'heal': {
          const p = view.players.get(ev.playerId);
          if (p && ev.playerId === localPlayerId) this.addText(p.x, p.y - 60, `+${ev.amount} HP`, '#e0445a', 16, 0.9);
          break;
        }
        case 'levelUp': {
          const p = view.players.get(ev.playerId);
          if (p && ev.playerId === localPlayerId) this.addText(p.x, p.y - 80, `LEVEL ${ev.level}!`, '#2e9e5b', 28, 1.6);
          break;
        }
        case 'upgrade': {
          const p = view.players.get(ev.playerId);
          if (p && ev.playerId === localPlayerId) {
            this.addText(p.x, p.y - 70, `${UPGRADE_INFO[ev.stat].name} ${ev.rank}`, '#2f6fb8', 18, 1);
          }
          break;
        }
        case 'kill':
          this.rings.push({ x: ev.x, y: ev.y, color: '#e5534b', radius: 38, age: 0, life: ev.kind in CONFIG.bosses ? 0.8 : 0.35 });
          break;
        case 'blocked':
          this.rings.push({ x: ev.x, y: ev.y, color: '#4a90e2', radius: 38, age: 0, life: 0.3 });
          break;
        case 'bulletCut':
          // A quick steel-colored spark where the blade met the bullet.
          this.rings.push({ x: ev.x, y: ev.y, color: '#6f7a84', radius: 26, age: 0, life: 0.22 });
          this.rings.push({ x: ev.x, y: ev.y, color: '#ffd166', radius: 14, age: 0, life: 0.16 });
          break;
        case 'wallHit':
          this.rings.push({ x: ev.x, y: ev.y, color: '#9aa4ad', radius: 14, age: 0, life: 0.2 });
          break;
        case 'wipe':
          this.rings.push({ x: ev.x, y: ev.y, color: '#7e57c2', radius: ev.radius, age: 0, life: 0.5 });
          break;
        case 'shotgun':
          this.addCone(ev.x, ev.y, ev.angle, ev.range, ev.arc);
          break;
        case 'bossSpawned':
          this.setBanner({ kind: 'boss', title: 'BOSS', subtitle: CONFIG.bosses[ev.kind].name, color: '#8b2635', age: 0, life: 2.5 });
          break;
        case 'powerUp':
          if (ev.playerId === localPlayerId) {
            const b = POWER_BANNERS[ev.buff];
            const subtitle = ev.buff === 'wipe' ? '' : `${CONFIG.powerUps.duration} s`;
            this.setBanner({ kind: 'power', title: b.title, subtitle, color: b.color, age: 0, life: 1.6 });
          }
          break;
        default:
          break;
      }
    }
  }

  update(dt: number): void {
    this.clock += dt;
    age(this.texts, dt, (t) => {
      t.y -= 40 * dt;
    });
    age(this.cones, dt);
    age(this.rings, dt);
    age(this.beams, dt);
    age(this.banners, dt);
    while (this.recentHits.length && this.clock - this.recentHits[0].time > DPS_WINDOW) this.recentHits.shift();
  }

  /** Damage per second dealt to enemies over the last few seconds (training room meter). */
  dps(): number {
    let sum = 0;
    for (const h of this.recentHits) sum += h.damage;
    return sum / DPS_WINDOW;
  }

  clear(): void {
    this.texts.length = 0;
    this.cones.length = 0;
    this.rings.length = 0;
    this.beams.length = 0;
    this.banners.length = 0;
    this.recentHits.length = 0;
  }

  /**
   * One banner per slot: a new one replaces the previous. Boss and tower news share
   * the middle of the screen; the match result replaces everything.
   */
  private setBanner(banner: Banner): void {
    const slot = (kind: Banner['kind']): string => (kind === 'tower' ? 'boss' : kind);
    for (let i = this.banners.length - 1; i >= 0; i--) {
      if (slot(this.banners[i].kind) === slot(banner.kind) || banner.kind === 'result') this.banners.splice(i, 1);
    }
    this.banners.push(banner);
  }

  private addText(x: number, y: number, text: string, color: string, size: number, life: number): void {
    this.texts.push({ x, y, text, color, size, age: 0, life });
  }

  private addCone(x: number, y: number, angle: number, range: number, arc: number): void {
    const pellets = Array.from({ length: 9 }, () => ({
      angle: angle + (Math.random() - 0.5) * arc,
      length: range * (0.6 + Math.random() * 0.4),
    }));
    this.cones.push({ x, y, angle, range, arc, pellets, age: 0, life: 0.25 });
  }
}

function age<T extends { age: number; life: number }>(items: T[], dt: number, tick?: (item: T) => void): void {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    item.age += dt;
    tick?.(item);
    if (item.age >= item.life) items.splice(i, 1);
  }
}
