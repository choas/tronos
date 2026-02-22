/**
 * Terms & Conditions content and version for TronOS AI service.
 *
 * Bumping TERMS_VERSION forces all users to re-accept the terms.
 */

export const TERMS_VERSION = "1.0.0";

export const TERMS_CONTENT = `# TronOS AI Service - Terms & Conditions

**Version ${TERMS_VERSION}**

By using the TronOS AI service ("@ai" commands with the TronOS provider), you agree to the following terms:

## 1. Service Description

TronOS AI provides AI-powered code generation, editing, explanation, and chat capabilities through the \`@ai\` command interface. The service is provided by the TronOS project.

## 2. Usage

- You are responsible for reviewing all AI-generated code before use.
- AI-generated code is provided "as-is" without warranty.
- Do not submit sensitive, private, or confidential information to the AI service.

## 3. Data

- Prompts and context are sent to the configured AI provider for processing.
- TronOS does not store your prompts or AI responses on external servers.
- Conversation history is stored locally in your browser/session.

## 4. Acceptable Use

- Use the AI service for lawful purposes only.
- Do not attempt to generate malicious code or exploit the service.
- Respect rate limits and fair usage policies.

## 5. Limitations

- The AI may produce incorrect, incomplete, or outdated code.
- The service may be unavailable or experience downtime.
- TronOS reserves the right to modify or discontinue the service.

## 6. Acceptance

By running \`@ai accept-terms\`, you acknowledge that you have read and agree to these terms.
Terms may be updated; you will be asked to re-accept if the version changes.

---

To accept these terms, run: **@ai accept-terms**
`;
