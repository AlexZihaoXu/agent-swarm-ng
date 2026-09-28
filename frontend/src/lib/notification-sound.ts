export function createNotificationSound() {
  let context: AudioContext | undefined;
  let gain: GainNode | undefined;
  let buffer: Promise<AudioBuffer | undefined> | undefined;
  let active: AudioBufferSourceNode | undefined;
  let disposed = false;
  const request = new AbortController();

  return {
    // Called directly from a pointer/keyboard gesture to satisfy autoplay policies.
    async unlock() {
      if (disposed || typeof AudioContext === 'undefined') return;
      try {
        if (!context) {
          context = new AudioContext();
          gain = context.createGain();
          gain.gain.value = 0.7;
          gain.connect(context.destination);
        }
        buffer ??= fetch('/sounds/aqua-drop.mp3', { signal: request.signal })
          .then(response => {
            if (!response.ok) throw new Error('Sound unavailable');
            return response.arrayBuffer();
          })
          .then(bytes => context!.decodeAudioData(bytes))
          .catch(() => undefined);
        if (context.state !== 'running') await context.resume();
      } catch {
        /* Sound is optional; browser restrictions must not break chat. */
      }
    },
    async play() {
      if (disposed || !context || context.state !== 'running' || !buffer) return;
      try {
        const decoded = await buffer;
        if (disposed || !decoded || context.state !== 'running') return;
        active?.stop();
        const source = context.createBufferSource();
        source.buffer = decoded;
        source.connect(gain!);
        source.onended = () => {
          source.disconnect();
          if (active === source) active = undefined;
        };
        active = source;
        source.start();
      } catch {
        /* No alerts or failed messages for blocked/unsupported audio. */
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      request.abort();
      try {
        active?.stop();
      } catch {
        /* Already stopped. */
      }
      void context?.close().catch(() => {});
    },
  };
}
