/** Runs many keyed animations through one native requestAnimationFrame loop. */
export class AnimationFrameBatch<Key, Animation> {
  private readonly active = new Map<Key, Animation>()
  private frame: number | null = null

  constructor(private readonly step: (animation: Animation, now: number) => boolean) {}

  schedule(key: Key, animation: Animation): void {
    this.active.set(key, animation)
    if (this.frame == null) this.frame = requestAnimationFrame(this.tick)
  }

  cancel(key: Key): void {
    this.active.delete(key)
    if (this.active.size === 0 && this.frame != null) {
      cancelAnimationFrame(this.frame)
      this.frame = null
    }
  }

  private readonly tick = (now: number): void => {
    for (const [key, animation] of this.active) {
      if (!this.step(animation, now)) this.active.delete(key)
    }
    this.frame = this.active.size > 0 ? requestAnimationFrame(this.tick) : null
  }
}
