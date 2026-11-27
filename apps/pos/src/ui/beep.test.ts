import { describe, expect, it, vi } from 'vitest';

import { createBeep } from './beep';

function fakeAudio() {
  const started: { frequency: number; seconds: number }[] = [];
  class FakeAudioContext {
    currentTime = 0;
    destination = {};
    resume = vi.fn(() => Promise.resolve());
    createGain() {
      return { gain: { value: 1 }, connect: vi.fn() };
    }
    createOscillator() {
      const frequency = { value: 0 };
      return {
        frequency,
        connect: vi.fn(),
        start: vi.fn(),
        stop: (at: number) => started.push({ frequency: frequency.value, seconds: at }),
      };
    }
  }
  return { Context: FakeAudioContext as unknown as typeof AudioContext, started };
}

describe('createBeep', () => {
  it('plays a higher, shorter tone for success than for an error', () => {
    const { Context, started } = fakeAudio();
    const beep = createBeep(Context);

    beep('ok');
    beep('error');

    expect(started).toHaveLength(2);
    expect(started[0]!.frequency).toBeGreaterThan(started[1]!.frequency);
    expect(started[0]!.seconds).toBeLessThan(started[1]!.seconds);
  });

  it('stays silent where there is no audio', () => {
    expect(() => createBeep(undefined)('ok')).not.toThrow();
  });

  it('never lets a sound problem stop a sale', () => {
    class Broken {
      constructor() {
        throw new Error('NotAllowedError');
      }
    }

    expect(() => createBeep(Broken as unknown as typeof AudioContext)('ok')).not.toThrow();
  });
});
