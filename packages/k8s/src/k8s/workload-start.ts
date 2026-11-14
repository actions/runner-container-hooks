import { Writable } from 'stream'

// The marker is unique to this invocation and emitted only after wrapper setup.
// Consume it without buffering arbitrary workload output or altering its bytes.
export class WorkloadStart extends Writable {
  started = false
  private pending = Buffer.alloc(0)
  private readonly marker: Buffer

  constructor(
    marker: string,
    private readonly destination: Writable
  ) {
    super()
    this.marker = Buffer.from(`${marker}\n`)
  }

  _write(chunk: Buffer, _encoding: string, callback: () => void): void {
    this.pending = Buffer.concat([this.pending, chunk])
    const index = this.pending.indexOf(this.marker)
    if (!this.started && index !== -1) {
      this.destination.write(this.pending.subarray(0, index))
      this.pending = this.pending.subarray(index + this.marker.length)
      this.started = true
    }
    // Retain only a possible marker prefix across websocket frames.
    let keep = 0
    if (!this.started) {
      for (let size = 1; size < this.marker.length; size++) {
        if (
          this.pending.subarray(-size).equals(this.marker.subarray(0, size))
        ) {
          keep = size
        }
      }
    }
    this.destination.write(this.pending.subarray(0, this.pending.length - keep))
    this.pending = this.pending.subarray(this.pending.length - keep)
    callback()
  }

  _final(callback: () => void): void {
    this.flush()
    callback()
  }

  flush(): void {
    this.destination.write(this.pending)
    this.pending = Buffer.alloc(0)
  }
}
