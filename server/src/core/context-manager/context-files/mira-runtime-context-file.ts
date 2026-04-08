import {
  AGENT_LLM_PROVIDER,
  MIRA_ROUTING_MODE,
  MIRA_VERSION,
  WORKFLOW_LLM_PROVIDER,
  NODEJS_BRIDGE_VERSION,
  PYTHON_BRIDGE_VERSION,
  PYTHON_TCP_SERVER_VERSION
} from '@/constants'
import { DateHelper } from '@/helpers/date-helper'
import { ContextFile } from '@/core/context-manager/context-file'
import { ContextProbeHelper } from '@/core/context-manager/context-probe-helper'

interface MiraRuntimeContextResolvers {
  getWorkflowLLMName: () => string
  getAgentLLMName: () => string
  getLocalLLMName: () => string
}

export class MiraRuntimeContextFile extends ContextFile {
  public readonly filename = 'MIRA_RUNTIME.md'
  public readonly ttlMs: number

  public constructor(
    private readonly probeHelper: ContextProbeHelper,
    private readonly resolvers: MiraRuntimeContextResolvers,
    ttlMs: number
  ) {
    super()
    this.ttlMs = ttlMs
  }

  public generate(): string {
    const npmProbe = this.probeHelper.probeCommandVersion('npm', ['--version'])
    const pnpmProbe = this.probeHelper.probeCommandVersion('pnpm', ['--version'])
    const gitProbe = this.probeHelper.probeCommandVersion('git', ['--version'])
    const workflowLlmName = this.resolvers.getWorkflowLLMName()
    const agentLlmName = this.resolvers.getAgentLLMName()
    const localLlmName = this.resolvers.getLocalLLMName()

    return [
      `> Runtime versions, routing/providers, LLMs and bridge/toolchain availability. I am running Mira ${MIRA_VERSION || 'unknown'} on Node ${process.version}; routing mode ${MIRA_ROUTING_MODE}; workflow provider ${WORKFLOW_LLM_PROVIDER || 'unset'}; agent provider ${AGENT_LLM_PROVIDER || 'unset'}; workflow LLM ${workflowLlmName}; agent LLM ${agentLlmName}; local LLM ${localLlmName}; npm ${this.probeHelper.formatCommandProbe(npmProbe)}, pnpm ${this.probeHelper.formatCommandProbe(pnpmProbe)}, git ${this.probeHelper.formatCommandProbe(gitProbe)}.`,
      '# MIRA_RUNTIME',
      `- Generated at: ${DateHelper.getDateTime()}`,
      `- Mira version: ${MIRA_VERSION || 'unknown'}`,
      `- Node.js version: ${process.version}`,
      `- Routing mode: ${MIRA_ROUTING_MODE}`,
      `- Workflow LLM provider: ${WORKFLOW_LLM_PROVIDER || 'unset'}`,
      `- Agent LLM provider: ${AGENT_LLM_PROVIDER || 'unset'}`,
      `- Workflow LLM: ${workflowLlmName}`,
      `- Agent LLM: ${agentLlmName}`,
      `- Local LLM: ${localLlmName}`,
      `- npm: ${this.probeHelper.formatCommandProbe(npmProbe)}`,
      `- pnpm: ${this.probeHelper.formatCommandProbe(pnpmProbe)}`,
      `- git: ${this.probeHelper.formatCommandProbe(gitProbe)}`,
      `- Node.js bridge version: ${NODEJS_BRIDGE_VERSION}`,
      `- Python bridge version: ${PYTHON_BRIDGE_VERSION}`,
      `- Python TCP server version: ${PYTHON_TCP_SERVER_VERSION}`
    ].join('\n')
  }
}
