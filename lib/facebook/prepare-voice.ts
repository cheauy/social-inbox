// Browser recordings may be Opus/WebM, which Messenger clients cannot play.
// Decode the recording and encode real PCM WAV bytes, never just rename it.
export async function prepareFacebookVoice(file: File): Promise<File> {
  if (!/audio\/(webm|ogg)/i.test(file.type)) return file;
  const context = new AudioContext();
  try {
    const audio = await context.decodeAudioData(await file.arrayBuffer());
    const samples = audio.length;
    const bytes = new ArrayBuffer(44 + samples * 2);
    if (bytes.byteLength > 25 * 1024 * 1024) {
      throw new Error("This voice recording is too long. Record a shorter message.");
    }
    const view = new DataView(bytes);
    const text = (offset: number, value: string) => {
      for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
    };
    text(0, "RIFF"); view.setUint32(4, bytes.byteLength - 8, true);
    text(8, "WAVE"); text(12, "fmt "); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, audio.sampleRate, true);
    view.setUint32(28, audio.sampleRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    text(36, "data"); view.setUint32(40, samples * 2, true);
    const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
    for (let i = 0; i < samples; i++) {
      const value = Math.max(-1, Math.min(1, channels.reduce((sum, channel) => sum + channel[i], 0) / channels.length));
      view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
    }
    return new File([bytes], file.name.replace(/\.[^.]+$/, "") + ".wav", { type: "audio/wav" });
  } finally {
    await context.close();
  }
}
