import { describe, expect, it } from 'vitest';

import { normaliseApiUrl } from './api-url';

describe('normaliseApiUrl', () => {
  it.each([
    ['https://api.example.com', 'https://api.example.com'],
    ['  https://api.example.com/  ', 'https://api.example.com'],
    ['https://api.example.com/v1', 'https://api.example.com'],
    ['https://api.example.com/v1///', 'https://api.example.com'],
    ['https://example.com/pos-api/', 'https://example.com/pos-api'],
    ['https://example.com/pos-api/v1', 'https://example.com/pos-api'],
    ['HTTPS://API.Example.com', 'https://api.example.com'],
    ['http://localhost:3000', 'http://localhost:3000'],
    ['http://127.0.0.1:3000/', 'http://127.0.0.1:3000'],
    ['http://[::1]:3000', 'http://[::1]:3000'],
  ])('accepts %j', (input, expected) => {
    expect(normaliseApiUrl(input)).toBe(expected);
  });

  it.each([
    '',
    '   ',
    'api.example.com',
    'not a url',
    'ftp://example.com',
    'javascript:alert(1)',
    // The device token must never cross the network in clear text.
    'http://api.example.com',
    'http://192.168.1.20:3000',
    'http://localhost.example.com',
    'https://user:secret@example.com',
    'https://example.com?key=1',
    'https://example.com#part',
  ])('rejects %j', (input) => {
    expect(normaliseApiUrl(input)).toBeNull();
  });
});
