import { describe, it, expect } from 'vitest';
import { READER_BUSY_MESSAGE, readerErrorMessage } from './client';

describe('what the owner is told when the reader fails', () => {
  it('is one calm sentence when the service is busy, with no gateway, model or status in it', () => {
    const raw = 'The AI gateway returned 503: This model is currently experiencing high demand. [Cloudflare; gateway; gemini-3.7-flash; gateway.ai.cloudflare.com/v1/{account}/{gateway}/google-ai-studio/v1beta/models/gemini-3.7-flash:generateContent]';
    const shown = readerErrorMessage(raw, 502);
    expect(shown).toBe('Due to high demand the parser is currently unavailable. Please try again later.');
    expect(shown).toBe(READER_BUSY_MESSAGE);
    expect(shown).not.toMatch(/gateway|gemini|503/i);
  });

  it('says the same for a rate limit, a timeout, no answer, or a service that cannot be reached', () => {
    for (const raw of ['The AI gateway returned 429: quota', 'The AI gateway returned 500', 'The AI gateway returned 504', 'The model took too long to answer.', 'The model returned no answer.', 'Could not reach the AI gateway.']) {
      expect(readerErrorMessage(raw, 502)).toBe(READER_BUSY_MESSAGE);
    }
  });

  it('keeps the detail of a setup problem, so the owner can fix the configuration', () => {
    expect(readerErrorMessage('The AI gateway returned 402: credits depleted [x]', 502)).toContain('credits depleted');
    expect(readerErrorMessage('The AI gateway returned 401: bad token', 502)).toContain('bad token');
    expect(readerErrorMessage('The AI gateway is not configured.', 503)).toContain('not configured');
  });

  it('leaves an already-calm message alone, and falls back to the status when there is none', () => {
    expect(readerErrorMessage(READER_BUSY_MESSAGE, 502)).toBe(READER_BUSY_MESSAGE);
    expect(readerErrorMessage(undefined, 500)).toBe('The document reader returned 500.');
  });
});
