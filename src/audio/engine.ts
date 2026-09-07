/**
 * Single shared AudioContext. The audio clock (ctx.currentTime) is the
 * single source of truth for all gameplay timing.
 */
class AudioEngine {
  private _ctx: AudioContext | null = null;

  get ctx(): AudioContext {
    if (!this._ctx) {
      this._ctx = new AudioContext();
    }
    if (this._ctx.state === 'suspended') {
      // Best-effort resume; calls usually happen inside user gestures.
      void this._ctx.resume();
    }
    return this._ctx;
  }

  async decodeBlob(blob: Blob): Promise<AudioBuffer> {
    const ab = await blob.arrayBuffer();
    return await this.ctx.decodeAudioData(ab);
  }
}

export const audioEngine = new AudioEngine();
