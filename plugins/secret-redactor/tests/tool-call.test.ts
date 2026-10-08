import { describe, expect, test } from 'claude-code/testing'

const EMAIL = 'person.name@realdomain.org'

describe('tool.call', () => {
  test('a failed Bash call with an email in its error text still settles, with the email hidden', async ($, on) => {
    on('ui.notice', () => ({ value: undefined }))
    on('tool.call', () => ({ isError: true, result: `fatal: bad object\nAuthor: ${EMAIL}`, text: `fatal: bad object\nAuthor: ${EMAIL}` }))
    const r = await $.tool.call({ tool: 'Bash', command: 'git show --stat HEAD' })
    // Core refuses a hook's string result for Bash, so the scrubbed error goes back as a deny
    expect(r.deny).toBeDefined()
    expect(r.deny).not.toContain(EMAIL)
    expect(r.deny).toContain('[REDACTED-EMAIL-')
  })

  test('a successful Bash call keeps its object shape, with the email hidden', async ($, on) => {
    on('ui.notice', () => ({ value: undefined }))
    on('tool.call', () => ({ result: { stdout: `Author: ${EMAIL}`, stderr: '', interrupted: false }, text: `Author: ${EMAIL}` }))
    const r = await $.tool.call({ tool: 'Bash', command: 'git log -1' })
    expect('result' in r && typeof r.result).toBe('object')
    expect(JSON.stringify('result' in r ? r.result : null)).not.toContain(EMAIL)
  })
})
