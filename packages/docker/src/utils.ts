/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable import/no-commonjs */
import * as core from '@actions/core'
import { env } from 'process'
// Import this way otherwise typescript has errors
const exec = require('@actions/exec')

export interface RunDockerCommandOptions {
  workingDir?: string
  input?: Buffer
  env?: { [key: string]: string }
}

export async function runDockerCommand(
  args: string[],
  options?: RunDockerCommandOptions
): Promise<string> {
  const pipes = await exec.getExecOutput('docker', args, options)
  if (pipes.exitCode !== 0) {
    core.error(`Docker failed with exit code ${pipes.exitCode}`)
    return Promise.reject(pipes.stderr)
  }
  return Promise.resolve(pipes.stdout)
}

export function sanitize(val: string): string {
  if (!val || typeof val !== 'string') {
    return ''
  }
  const newNameBuilder: string[] = []
  for (let i = 0; i < val.length; i++) {
    const char = val.charAt(i)
    if (!newNameBuilder.length) {
      if (isAlpha(char)) {
        newNameBuilder.push(char)
      }
    } else {
      if (isAlpha(char) || isNumeric(char) || char === '_') {
        newNameBuilder.push(char)
      }
    }
  }
  return newNameBuilder.join('')
}

export function checkEnvironment(): void {
  if (!env.GITHUB_WORKSPACE) {
    throw new Error('GITHUB_WORKSPACE is not set')
  }
}

// isAlpha accepts single character and checks if
// that character is [a-zA-Z]
function isAlpha(val: string): boolean {
  return (
    val.length === 1 &&
    ((val >= 'a' && val <= 'z') || (val >= 'A' && val <= 'Z'))
  )
}

function isNumeric(val: string): boolean {
  return val.length === 1 && val >= '0' && val <= '9'
}
