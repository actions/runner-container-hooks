import { Writable } from 'stream'
import { WorkloadStart } from '../src/k8s/workload-start'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawnSync } from 'child_process'
import { writeRunScript, writeContainerStepScript } from '../src/k8s/utils'

const marker = 'HOOK_WORKLOAD_START_test'
test('fragmented marker removed with all other bytes preserved', () => {
  const chunks: Buffer[] = []
  const destination = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk)
      cb()
    }
  })
  const stream = new WorkloadStart(marker, destination)
  const input = Buffer.from(`before${marker}\nafter\u2603`)
  for (const byte of Array.from(input)) stream.write(Buffer.from([byte]))
  stream.flush()
  expect(stream.started).toBe(true)
  expect(Buffer.concat(chunks).toString()).toBe('beforeafter\u2603')
})
test('partial and mismatched markers preserve output and do not launch', () => {
  const chunks: Buffer[] = []
  const destination = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk)
      cb()
    }
  })
  const stream = new WorkloadStart(marker, destination)
  const input = `${marker}wrong\nHOOK_WORKLOAD`
  stream.write(input)
  stream.flush()
  expect(stream.started).toBe(false)
  expect(Buffer.concat(chunks).toString()).toBe(input)
})

test('stream end flushes partial marker without ending the destination', () => {
  const chunks: Buffer[] = []
  const destination = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk)
      cb()
    }
  })
  const stream = new WorkloadStart(marker, destination)
  stream.end('HOOK_WORKLOAD')
  expect(Buffer.concat(chunks).toString()).toBe('HOOK_WORKLOAD')
  expect(destination.writableEnded).toBe(false)
})

describe('generated shell wrapper launch evidence', () => {
  let dir: string
  const previousTemp = process.env.RUNNER_TEMP
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hook-wrapper-'))
    process.env.RUNNER_TEMP = dir
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    if (previousTemp === undefined) delete process.env.RUNNER_TEMP
    else process.env.RUNNER_TEMP = previousTemp
  })
  test.each([0, 1, 17, 255])(
    'actual workload exit %i emits launch marker',
    code => {
      const { runnerPath } = writeRunScript(
        dir,
        'sh',
        ['-c', `'exit ${code}'`],
        undefined,
        undefined,
        marker
      )
      const result = spawnSync('sh', ['-e', runnerPath])
      expect(result.status).toBe(code)
      expect(result.stderr.toString()).toBe(`${marker}\n`)
    }
  )
  test('failed cd has no launch marker', () => {
    const { runnerPath } = writeRunScript(
      join(dir, 'missing'),
      'true',
      [],
      undefined,
      undefined,
      marker
    )
    const result = spawnSync('sh', ['-e', runnerPath])
    expect(result.status).not.toBe(0)
    expect(result.stderr.toString()).not.toContain(marker)
  })
  test('failed rm has no launch marker', () => {
    const bin = join(dir, 'bin')
    mkdirSync(bin)
    writeFileSync(join(bin, 'rm'), '#!/bin/sh\nexit 19\n', { mode: 0o755 })
    const { runnerPath } = writeRunScript(
      dir,
      'true',
      [],
      undefined,
      undefined,
      marker
    )
    const result = spawnSync('/bin/sh', ['-e', runnerPath], {
      env: { ...process.env, PATH: bin }
    })
    expect(result.status).toBe(19)
    expect(result.stderr.toString()).not.toContain(marker)
  })
  test('failed container workspace mv has no launch marker', () => {
    const { runnerPath } = writeContainerStepScript(
      dir,
      '/repo/project',
      'true',
      [],
      undefined,
      marker
    )
    // Relocate container absolute paths into this isolated fixture. No pod or host directories touched.
    writeFileSync(
      runnerPath,
      readFileSync(runnerPath, 'utf8')
        .split('/__w')
        .join(`${dir}/work`)
        .split('/github')
        .join(`${dir}/github`)
    )
    const result = spawnSync('sh', ['-e', runnerPath])
    expect(result.status).not.toBe(0)
    expect(result.stderr.toString()).not.toContain(marker)
  })
  test('legacy wrapper emits no marker', () => {
    const { runnerPath } = writeRunScript(dir, 'true')
    const result = spawnSync('sh', ['-e', runnerPath])
    expect(result.status).toBe(0)
    expect(result.stderr.toString()).toBe('')
  })
})
