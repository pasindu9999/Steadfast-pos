/** Short tones for scan feedback, made on the device so they work offline. */
export type Tone = 'ok' | 'error';

const TONES: Record<Tone, { hz: number; seconds: number }> = {
  ok: { hz: 880, seconds: 0.08 },
  error: { hz: 220, seconds: 0.25 },
};

const VOLUME = 0.1;

export function createBeep(
  Context: typeof AudioContext | undefined = globalThis.AudioContext,
): (tone: Tone) => void {
  let context: AudioContext | undefined;

  return (tone) => {
    if (!Context) return;
    try {
      context ??= new Context();
      // Browsers start audio suspended until the first key press or tap.
      void context.resume().catch(() => undefined);
      const { hz, seconds } = TONES[tone];
      const gain = context.createGain();
      gain.gain.value = VOLUME;
      gain.connect(context.destination);
      const oscillator = context.createOscillator();
      oscillator.frequency.value = hz;
      oscillator.connect(gain);
      oscillator.start();
      oscillator.stop(context.currentTime + seconds);
    } catch {
      // A sound is never worth interrupting a sale for.
    }
  };
}
