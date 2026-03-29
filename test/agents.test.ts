import { describe, it, expect, beforeEach } from 'vitest';
import { AgentRuntime, parseTrigger, parseInterval } from '../src/agents/runtime';
import { canRead, canWrite, matchesGlob, parseGlobs, emptyPermissions } from '../src/agents/permissions';
import { GuardQueue } from '../src/agents/guard';
import { parseAgentManifest } from '../src/agents/manifest';

describe('Agent Permissions', () => {
  it('should match exact paths', () => {
    expect(matchesGlob('/home/user/file.txt', ['/home/user/file.txt'])).toBe(true);
  });

  it('should match wildcard patterns', () => {
    expect(matchesGlob('/home/user/file.txt', ['/home/user/*'])).toBe(true);
    expect(matchesGlob('/home/user/sub/file.txt', ['/home/user/*'])).toBe(false);
  });

  it('should match double-star patterns', () => {
    expect(matchesGlob('/home/user/sub/deep/file.txt', ['/home/user/**'])).toBe(true);
  });

  it('should check read permissions', () => {
    const perms = { ...emptyPermissions(), read: ['/home/user/**', '/proc/context/*'] };
    expect(canRead(perms, '/home/user/file.txt')).toBe(true);
    expect(canRead(perms, '/proc/context/workspace')).toBe(true);
    expect(canRead(perms, '/etc/passwd')).toBe(false);
  });

  it('should check write permissions', () => {
    const perms = { ...emptyPermissions(), write: ['/home/user/digest.md'] };
    expect(canWrite(perms, '/home/user/digest.md')).toBe(true);
    expect(canWrite(perms, '/home/user/other.md')).toBe(false);
  });

  it('should parse glob strings', () => {
    const globs = parseGlobs('/home/user/**, /tmp/*');
    expect(globs).toEqual(['/home/user/**', '/tmp/*']);
  });
});

describe('Agent Runtime', () => {
  let runtime: AgentRuntime;

  beforeEach(() => {
    runtime = new AgentRuntime();
  });

  it('should start an agent', async () => {
    const id = await runtime.start('test-agent', 'Test goal', emptyPermissions(), { type: 'manual' });
    expect(id).toBeDefined();

    const agent = runtime.getAgent(id);
    expect(agent).toBeDefined();
    expect(agent!.name).toBe('test-agent');
    expect(agent!.goal).toBe('Test goal');
    expect(agent!.status).toBe('running');
  });

  it('should list agents', async () => {
    await runtime.start('agent1', 'Goal 1', emptyPermissions(), { type: 'manual' });
    await runtime.start('agent2', 'Goal 2', emptyPermissions(), { type: 'manual' });

    const agents = runtime.listAgents();
    expect(agents.length).toBe(2);
  });

  it('should suspend and resume', async () => {
    const id = await runtime.start('test', 'Goal', emptyPermissions(), { type: 'manual' });

    await runtime.suspend(id);
    expect(runtime.getAgent(id)!.status).toBe('suspended');

    await runtime.resume(id);
    expect(runtime.getAgent(id)!.status).toBe('running');
  });

  it('should kill an agent', async () => {
    const id = await runtime.start('test', 'Goal', emptyPermissions(), { type: 'manual' });
    await runtime.kill(id);
    expect(runtime.getAgent(id)!.status).toBe('done');
  });

  it('should check permissions and log violations', async () => {
    const perms = { ...emptyPermissions(), read: ['/home/**'] };
    const id = await runtime.start('test', 'Goal', perms, { type: 'manual' });

    expect(runtime.checkPermission(id, 'read', '/home/user/file.txt')).toBe(true);
    expect(runtime.checkPermission(id, 'read', '/etc/secret')).toBe(false);

    const agent = runtime.getAgent(id)!;
    expect(agent.violations.length).toBe(1);
    expect(agent.violations[0].target).toBe('/etc/secret');
  });

  it('should get agent by PID', async () => {
    const id = await runtime.start('test', 'Goal', emptyPermissions(), { type: 'manual' });
    const agent = runtime.getAgent(id)!;
    const found = runtime.getAgentByPid(agent.pid);
    expect(found).toBe(agent);
  });
});

describe('GuardQueue', () => {
  let queue: GuardQueue;

  beforeEach(() => {
    queue = new GuardQueue();
  });

  it('should accept and list pending requests', () => {
    queue.request({
      agent_id: '001',
      agent_name: 'test-agent',
      action: 'write',
      target: '/etc/config.json',
    });

    const pending = queue.getPending();
    expect(pending.length).toBe(1);
    expect(pending[0].agent_name).toBe('test-agent');
  });

  it('should approve requests', async () => {
    const promise = queue.request({
      agent_id: '001',
      agent_name: 'test-agent',
      action: 'write',
      target: '/test',
    });

    const pending = queue.getPending();
    expect(pending.length).toBe(1);

    queue.approve(pending[0].id);
    const result = await promise;
    expect(result).toBe(true);
    expect(queue.getPending().length).toBe(0);
  });

  it('should reject requests', async () => {
    const promise = queue.request({
      agent_id: '001',
      agent_name: 'test-agent',
      action: 'write',
      target: '/test',
    });

    const pending = queue.getPending();
    queue.reject(pending[0].id);
    const result = await promise;
    expect(result).toBe(false);
  });

  it('should auto-approve based on policy', async () => {
    queue.addAutoApprove('test-agent', 'read', '/home/**');

    const result = await queue.request({
      agent_id: '001',
      agent_name: 'test-agent',
      action: 'read',
      target: '/home/user/file.txt',
    });

    expect(result).toBe(true);
    expect(queue.getPending().length).toBe(0);
  });

  it('should track approval log', async () => {
    const promise = queue.request({
      agent_id: '001',
      agent_name: 'test-agent',
      action: 'write',
      target: '/test',
    });

    const pending = queue.getPending();
    queue.approve(pending[0].id);
    await promise;

    const log = queue.getLog();
    expect(log.length).toBe(1);
    expect(log[0].status).toBe('approved');
  });
});

describe('Trigger Parsing', () => {
  it('should parse @every interval', () => {
    const trigger = parseTrigger('@every 5m');
    expect(trigger.type).toBe('interval');
    expect(trigger.intervalMs).toBe(300000);
  });

  it('should parse @daily', () => {
    const trigger = parseTrigger('@daily');
    expect(trigger.type).toBe('interval');
    expect(trigger.intervalMs).toBe(86400000);
  });

  it('should parse @file trigger', () => {
    const trigger = parseTrigger('@file /home/user/inbox');
    expect(trigger.type).toBe('file');
    expect(trigger.value).toBe('/home/user/inbox');
  });

  it('should parse @context-change', () => {
    const trigger = parseTrigger('@context-change');
    expect(trigger.type).toBe('context-change');
  });

  it('should parse @manual', () => {
    const trigger = parseTrigger('@manual');
    expect(trigger.type).toBe('manual');
  });
});

describe('Interval Parsing', () => {
  it('should parse seconds', () => {
    expect(parseInterval('30s')).toBe(30000);
  });
  it('should parse minutes', () => {
    expect(parseInterval('5m')).toBe(300000);
  });
  it('should parse hours', () => {
    expect(parseInterval('2h')).toBe(7200000);
  });
  it('should parse days', () => {
    expect(parseInterval('1d')).toBe(86400000);
  });
});

describe('Agent Manifest Parser', () => {
  it('should parse a valid .agent manifest', () => {
    const source = `#!/aios-agent
// @name: inbox-monitor
// @description: Summarize inbox files
// @version: 1.0.0
// @trigger: @every 5m
// @permissions.read: /home/user/inbox/**
// @permissions.write: /home/user/digest.md
// @permissions.network: false
// @escalate: never

(async function(a) {
  a.log('Running inbox monitor');
  a.done();
})`;

    const manifest = parseAgentManifest(source);
    expect(manifest.success).toBe(true);
    expect(manifest.name).toBe('inbox-monitor');
    expect(manifest.description).toBe('Summarize inbox files');
    expect(manifest.trigger?.type).toBe('interval');
    expect(manifest.trigger?.intervalMs).toBe(300000);
    expect(manifest.permissions?.read).toContain('/home/user/inbox/**');
    expect(manifest.permissions?.write).toContain('/home/user/digest.md');
    expect(manifest.escalate).toBe('never');
  });

  it('should fail without @name', () => {
    const source = `// @description: No name\n(async function(a) {})`;
    const manifest = parseAgentManifest(source);
    expect(manifest.success).toBe(false);
    expect(manifest.error).toContain('name');
  });

  it('should always include /proc/context/* in read permissions', () => {
    const source = `// @name: test\n// @permissions.read: /home/**\n(async function(a) {})`;
    const manifest = parseAgentManifest(source);
    expect(manifest.permissions?.read).toContain('/proc/context/*');
  });
});
