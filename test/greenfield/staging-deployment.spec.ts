import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relativePath: string): string =>
  fs.readFileSync(path.join(root, relativePath), 'utf8')

describe('owner-controlled staging deployment', () => {
  it('keeps the initial environment non-secret and non-destructive', () => {
    const environment = read('deploy/staging/mira.env.example')

    expect(environment).toContain('MIRA_HTTP_API_KEY=REPLACE_')
    expect(environment).toContain('MIRA_GREENFIELD_TRACE_MASTER_KEY=REPLACE_')
    expect(environment).toContain('MIRA_GREENFIELD_MEMORY_MASTER_KEY=REPLACE_')
    expect(environment).toContain('MIRA_GREENFIELD_OWNER_LOOKUP_KEY=REPLACE_')
    expect(environment).toContain('MIRA_STAGING_ALLOW_DESTRUCTIVE=false')

    const permissions = environment
      .split('\n')
      .find((line) => line.startsWith('MIRA_GREENFIELD_PERMISSIONS='))
    expect(permissions).toBeDefined()
    expect(permissions).not.toContain('trace.purge')
    expect(permissions).not.toContain('memory.purge')
  })

  it('binds initial staging to loopback through an explicit server setting', () => {
    const environment = read('deploy/staging/mira.env.example')
    const server = read('server/src/core/http-server/http-server.ts')
    const preflight = read('scripts/deploy/staging-preflight.sh')

    expect(environment).toContain('MIRA_BIND_HOST=127.0.0.1')
    expect(server).toContain("process.env['MIRA_BIND_HOST'] || '0.0.0.0'")
    expect(server).toContain('host: bindHost')
    expect(preflight).toContain('initial staging must bind to 127.0.0.1')
  })

  it('runs Mira as a user-scoped, restartable service', () => {
    const service = read('deploy/staging/mira-staging.service')

    expect(service).toContain('WorkingDirectory=%h/mira-deploy/current')
    expect(service).toContain('EnvironmentFile=%h/.config/mira-staging/mira.env')
    expect(service).toContain('ExecStartPre=%h/.local/bin/mira-staging-node')
    expect(service).toContain('ExecStart=%h/.local/bin/mira-staging-node')
    expect(service).toContain('Restart=on-failure')
    expect(service).toContain('NoNewPrivileges=true')
    expect(service).not.toMatch(/^User=root$/m)
  })

  it('requires a protected labeled self-hosted runner and manual dispatch', () => {
    const deploy = read('.github/workflows/mira-staging-deploy.yml')
    const rollback = read('.github/workflows/mira-staging-rollback.yml')

    for (const workflow of [deploy, rollback]) {
      expect(workflow).toContain('workflow_dispatch:')
      expect(workflow).not.toContain('pull_request:')
      expect(workflow).not.toContain('push:')
      expect(workflow).toContain('runs-on: [self-hosted, linux, x64, mira-staging]')
      expect(workflow).toContain('name: mira-staging')
      expect(workflow).toContain('contents: read')
    }
  })

  it('validates the exact ref before deployment', () => {
    const workflow = read('.github/workflows/mira-staging-deploy.yml')

    expect(workflow).toContain('Type-check server')
    expect(workflow).toContain('Run greenfield tests')
    expect(workflow).toContain('Lint repository')
    expect(workflow).toContain('Build production server')
    expect(workflow).toContain('Build production client')
    expect(workflow).toContain('Validate deployment shell scripts')
    expect(workflow.indexOf('needs: validate')).toBeGreaterThan(0)
  })

  it('restores the previous release when start or smoke verification fails', () => {
    const deployment = read('scripts/deploy/staging-deploy.sh')
    const rollback = read('scripts/deploy/staging-rollback.sh')

    expect(deployment).toContain('rollback_previous')
    expect(deployment).toContain('authenticated smoke verification failed')
    expect(deployment).toContain('mv -Tf')
    expect(deployment).not.toContain('sudo ')

    expect(rollback).toContain('restore_original')
    expect(rollback).toContain('rollback target failed authenticated smoke verification')
    expect(rollback).not.toContain('sudo ')
  })

  it('uploads only content-free smoke evidence', () => {
    const smoke = read('scripts/deploy/staging-smoke.sh')

    expect(smoke).toContain('chain_valid')
    expect(smoke).toContain("owner_scope_probe: 'not_found_as_expected'")
    expect(smoke).not.toContain('export_bundle')
    expect(smoke).not.toContain('memory.content')
    expect(smoke).not.toContain('owner_id:')
    expect(smoke).not.toContain('device_id:')
  })

  it('fails closed on placeholders, key reuse, broad file mode, and destructive grants', () => {
    const preflight = read('scripts/deploy/staging-preflight.sh')

    expect(preflight).toContain('still contains a placeholder')
    expect(preflight).toContain('keys must be distinct')
    expect(preflight).toContain('environment file group permissions are too broad')
    expect(preflight).toContain('is forbidden until destructive staging acceptance')
    expect(preflight).toContain('must remain under')
  })
})
