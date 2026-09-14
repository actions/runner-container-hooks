import { parsePositiveMsEnv } from './heartbeat'

// Back-off between polls of a pod's phase or a job's status. It starts at
// ACTIONS_RUNNER_BACKOFF_INITIAL_MS, doubles after every poll and never
// exceeds ACTIONS_RUNNER_BACKOFF_MAX_MS. The defaults are the 1 s to 20 s
// ladder the hook has always used; a cluster where the job pod is Running a
// few seconds after creation can poll faster and start the job sooner.
const DEFAULT_BACKOFF_INITIAL_MS = 1000
const DEFAULT_BACKOFF_MAX_MS = 20 * 1000

export class BackOffManager {
  private backOffMs: number
  private readonly maxBackOffMs: number
  totalTime = 0
  constructor(private throwAfterSeconds?: number) {
    if (!throwAfterSeconds || throwAfterSeconds < 0) {
      this.throwAfterSeconds = undefined
    }
    this.backOffMs = parsePositiveMsEnv(
      process.env.ACTIONS_RUNNER_BACKOFF_INITIAL_MS,
      DEFAULT_BACKOFF_INITIAL_MS
    )
    // A maximum below the initial value would make the first wait the
    // longest; the initial value is the floor of the ceiling.
    this.maxBackOffMs = Math.max(
      this.backOffMs,
      parsePositiveMsEnv(
        process.env.ACTIONS_RUNNER_BACKOFF_MAX_MS,
        DEFAULT_BACKOFF_MAX_MS
      )
    )
  }

  async backOff(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, this.backOffMs))
    this.totalTime += this.backOffMs / 1000
    if (this.throwAfterSeconds && this.throwAfterSeconds < this.totalTime) {
      throw new Error('backoff timeout')
    }
    this.backOffMs = Math.min(this.backOffMs * 2, this.maxBackOffMs)
  }
}
