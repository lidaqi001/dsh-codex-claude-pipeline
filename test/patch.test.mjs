// Static smoke tests for the bundle. No dependencies, no build step: every
// assertion reads files that ship with the plugin and checks the invariants a
// typo would silently break (row ids, provider/tool wiring, packaged files).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (name) => readFileSync(join(root, name), 'utf8')
const manifest = JSON.parse(read('package.json'))
const patch = read('cordis.patch.yml')

test('package manifest is a publishable dsh bundle', () => {
  assert.equal(manifest.name, 'dsh-codex-claude-pipeline')
  assert.match(manifest.version, /^\d+\.\d+\.\d+/)
  assert.equal(manifest.license, 'MIT')
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(manifest.repository?.url, 'git+https://github.com/lidaqi001/dsh-codex-claude-pipeline.git')
  assert.ok(manifest.engines?.dsh, 'engines.dsh is declared')
  assert.ok(manifest.dependencies?.['@deepseek-ai/dsh-subagent-codex'], 'codex provider is a dependency')
  assert.ok(manifest.dependencies?.['@deepseek-ai/dsh-subagent-claude-code'], 'claude-code provider is a dependency')
  assert.ok(manifest.keywords?.includes('dsh-plugin'))
})

test('the declared patch and icon exist', () => {
  for (const file of [manifest.dsh.bundle.patch, manifest.icon, 'README.md', 'LICENSE']) {
    assert.ok(existsSync(join(root, file)), `${file} exists`)
  }
})

test('the published file list covers every runtime resource', () => {
  const files = manifest.files ?? []
  for (const needed of ['cordis.patch.yml', 'icon.svg', 'README.md', 'LICENSE', 'assets/icon-180.png']) {
    assert.ok(files.includes(needed), `files[] includes ${needed}`)
  }
  assert.ok(files.includes('locale/*.json'), 'files[] includes locale JSON')
  assert.ok(existsSync(join(root, 'locale/en.json')) && existsSync(join(root, 'locale/zh.json')))
  assert.ok(existsSync(join(root, 'assets/icon-180.png')), '180px icon exists')
})

test('loader rows and preset plugin rows have unique ids', () => {
  const ids = [...patch.matchAll(/^(\s*)- id: ([a-z0-9-]+)$/gm)].map((match) => match[2])
  assert.ok(ids.length >= 7, 'all rows are found')
  assert.equal(new Set(ids).size, ids.length, `duplicate row id in ${ids.join(', ')}`)
})

test('host providers are dedicated instances wired to the matching preset tools', () => {
  const rows = [...patch.matchAll(/providerName:\s*([a-z0-9-]+)/g)].map((match) => match[1])
  assert.deepEqual(rows, ['codex-planner', 'claude-code-executor'])

  const codexTool = patch.slice(patch.indexOf('- id: tool-codex-planner'))
  const claudeTool = patch.slice(patch.indexOf('- id: tool-claude-code-executor'))
  assert.equal(codexTool.match(/provider:\s*([^\s#]+)/)?.[1], 'codex-planner')
  assert.equal(claudeTool.match(/provider:\s*([^\s#]+)/)?.[1], 'claude-code-executor')

  assert.match(patch, /id: subagent-codex-planner[\s\S]*?name: '@deepseek-ai\/dsh-subagent-codex'[\s\S]*?permissionMode: never/)
  assert.match(patch, /id: subagent-claude-code-executor[\s\S]*?name: '@deepseek-ai\/dsh-subagent-claude-code'[\s\S]*?permissionMode: auto/)
  assert.equal(codexTool.match(/maxDepth:\s*([^\s#]+)/)?.[1], 'provider-managed')
  assert.equal(claudeTool.match(/maxDepth:\s*([^\s#]+)/)?.[1], 'provider-managed')
})

test('preset declaration carries the expected identity and both tool names', () => {
  assert.match(patch, /id: preset-codex-claude/m)
  assert.match(patch, /^\s{8}id: codex-claude$/m)
  assert.match(patch, /^\s{8}name: Codex 规划 \+ Claude Code 执行$/m)
  assert.match(patch, /^\s{8}order: 7$/m)
  assert.match(patch, /toolName: subagent_codex/)
  assert.match(patch, /toolName: subagent_claude_code/)
  assert.match(patch, /name: '@deepseek-ai\/dsh-agent-preset'/)
})

test('persona is the complete system prompt and enforces the two-stage flow', () => {
  assert.match(patch, /complete: true/)
  const persona = patch.slice(patch.indexOf('prefix: |-'), patch.indexOf('# 规划工具'))
  assert.ok(persona.length > 1000, 'persona text is present')
  for (const expected of [
    'Codex 规划 + Claude Code 执行',
    'subagent_codex',
    'subagent_claude_code',
    '只读分析',
    '验收标准',
    '完成通知',
    'ask_user_question',
    'todo_write',
    '不要轮询',
    '不要伪造',
  ]) {
    assert.ok(persona.includes(expected), `persona mentions ${expected}`)
  }
})

test('compaction group is isolated and complete', () => {
  assert.match(patch, /isolate:\n\s+compaction: true/)
  assert.match(patch, /'@deepseek-ai\/dsh-compaction-basic'/)
  assert.match(patch, /'@deepseek-ai\/dsh-command-compact'/)
})

test('locale dictionaries describe the plugin', () => {
  for (const lang of ['en', 'zh']) {
    const dict = JSON.parse(read(`locale/${lang}.json`))
    assert.ok(dict.meta?.title?.trim(), `${lang} meta.title`)
    assert.ok(dict.meta?.description?.trim(), `${lang} meta.description`)
  }
})

test('README documents installation and the mode name', () => {
  const readme = read('README.md')
  assert.ok(readme.includes('dsh plugin --profile <profile> add dsh-codex-claude-pipeline'))
  assert.ok(readme.includes('Codex 规划 + Claude Code 执行'))
  assert.ok(readme.includes('subagent_codex'))
  assert.ok(readme.includes('subagent_claude_code'))
})
