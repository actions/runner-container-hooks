import { createContainerSpec } from '../src/hooks/prepare-job'
import { fixArgs } from '../src/k8s/utils'
import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

describe('job and service container arguments', () => {
  it.each(['sh', '/bin/sh', 'bash', '/bin/bash', undefined])(
    'preserves argument boundaries with entrypoint %p',
    entryPoint => {
      const args = ['-c', 'printf "%s" "$1"', 'label', 'hello world', '']
      const container = createContainerSpec(
        {
          image: 'ubuntu',
          contextName: 'service',
          entryPoint,
          entryPointArgs: args
        },
        'service'
      )

      expect(container.command).toEqual(entryPoint ? [entryPoint] : undefined)
      expect(container.args).toEqual(args)
    }
  )

  it('decodes runner-quoted arguments without losing spaces, quotes or empty strings', () => {
    const args = ['hello world', '"literal quotes"', '']
    const container = createContainerSpec(
      {
        image: 'ubuntu',
        contextName: 'service',
        entryPoint: 'echo',
        entryPointArgs: String.raw`"hello world" "\"literal quotes\"" ""`.split(
          ' '
        )
      },
      'service'
    )

    expect(container.args).toEqual(args)
  })

  it.each([
    String.raw`"-c" "printf \"%s\" \"$1\"" "label" "hello world"`.split(' '),
    String.raw`-c "printf \"%s\" \"$1\"" label "hello world"`.split(' '),
    `-c 'printf "%s" "$1"' label 'hello world'`.split(' ')
  ])(
    'decodes a quoted script for job/service containers (case %#)',
    (...args) => {
      const container = createContainerSpec(
        {
          image: 'ubuntu',
          contextName: 'service',
          entryPoint: 'sh',
          entryPointArgs: args
        },
        'service'
      )
      const expected = ['-c', 'printf "%s" "$1"', 'label', 'hello world']
      expect(container.args).toEqual(expected)
      expect(fixArgs(['sh', ...args])).toEqual(['sh', ...expected])
      const result = spawnSync('sh', container.args, { encoding: 'utf8' })
      expect(result.status).toBe(0)
      expect(result.stdout).toBe('hello world')
    }
  )

  it('does not retokenize a raw script starting with a quoted executable', () => {
    const args = ['-c', '"printf" "%s" "$1"', 'label', 'hello world']
    expect(fixArgs(args)).toEqual(args)
    expect(fixArgs(['sh', ...args])).toEqual(['sh', ...args])
  })

  it('decodes only the serialization quotes around a quoted expression', () => {
    expect(fixArgs(String.raw`"-c" "\"$TOOL\""`.split(' '))).toEqual([
      '-c',
      '"$TOOL"'
    ])
  })

  it.each(['"$TOOL"', '"$1"', '"./my tool"', "'./my tool'"])(
    'executes a raw script consisting entirely of a quoted expression: %s',
    script => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-args-'))
      try {
        fs.writeFileSync(
          path.join(directory, 'my tool'),
          '#!/bin/sh\nprintf "%s" "tool ran"\n',
          { mode: 0o700 }
        )
        const args = ['-c', script, 'label', './my tool', '']
        const container = createContainerSpec(
          {
            image: 'ubuntu',
            contextName: 'service',
            entryPoint: 'sh',
            entryPointArgs: args
          },
          'service'
        )
        const command = fixArgs(['sh', ...args])
        const result = spawnSync(command[0], command.slice(1), {
          cwd: directory,
          env: { ...process.env, TOOL: './my tool' },
          encoding: 'utf8'
        })
        expect(result.status).toBe(0)
        expect(result.stdout).toBe('tool ran')
        expect(container.args).toEqual(args)
        expect(command).toEqual(['sh', ...args])
      } finally {
        fs.rmSync(directory, { recursive: true, force: true })
      }
    }
  )

  it('preserves empty scripts and parameters after decoding', () => {
    expect(fixArgs(['"-c"', "''", 'label', '""'])).toEqual([
      '-c',
      '',
      'label',
      ''
    ])
    expect(fixArgs(['-c', '', 'label', ''])).toEqual(['-c', '', 'label', ''])
    expect(fixArgs(['-c', "''", 'label', '""'])).toEqual([
      '-c',
      "''",
      'label',
      '""'
    ])
  })

  it('decodes escaped backslashes without changing the script', () => {
    expect(
      fixArgs(String.raw`-c "printf \"%s\" \"a\\\\b\""`.split(' '))
    ).toEqual(['-c', String.raw`printf "%s" "a\\b"`])
  })
})
