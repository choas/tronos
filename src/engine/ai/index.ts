// AI module exports
export {
  parseAICommand,
  isAICommand,
  getAICommandPrefix,
  validateAICommand,
  type AIMode,
  type AICommand
} from './parser';

export {
  buildSystemPrompt,
  buildUserMessage,
  getTerminalAPIReference,
  getExecutableFormatSpec,
  type PromptContext
} from './prompts';

export {
  AIBridge,
  createAIBridge,
  type AIResponse,
  type ParsedResponse,
  type Message
} from './bridge';
