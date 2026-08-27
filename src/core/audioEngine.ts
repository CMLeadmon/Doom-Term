import { DmxSound, SoundEffectType } from '../types/wad';

interface ActiveVoice {
  id: string;
  source: AudioBufferSourceNode;
  gainNode: GainNode;
  priority: number;
  startedAt: number;
}

export class AudioEngine {
  private static instance: AudioEngine;
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private voices: (ActiveVoice | null)[] = new Array(8).fill(null);
  private lastTriggerTimes: Map<string, number> = new Map();
  private dmxSoundCache: Map<string, AudioBuffer> = new Map();
  private volume: number = 0.7;
  private muted: boolean = false;
  private initialized: boolean = false;

  private constructor() {
    // Lazy initialize on first interaction
    const initHandler = () => {
      this.initContext();
      window.removeEventListener('click', initHandler);
      window.removeEventListener('keydown', initHandler);
    };
    window.addEventListener('click', initHandler);
    window.addEventListener('keydown', initHandler);
  }

  public static getInstance(): AudioEngine {
    if (!AudioEngine.instance) {
      AudioEngine.instance = new AudioEngine();
    }
    return AudioEngine.instance;
  }

  private initContext() {
    if (this.initialized) return;
    try {
      const AudioCtx = typeof window !== 'undefined'
        ? window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        : undefined;

      if (typeof AudioCtx !== 'function') {
        this.initialized = true;
        return;
      }

      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : this.volume;
      this.masterGain.connect(this.ctx.destination);
      this.initialized = true;
    } catch {
      this.initialized = true;
    }
  }

  public setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && !this.muted) {
      this.masterGain.gain.setValueAtTime(this.volume, this.ctx?.currentTime || 0);
    }
  }

  public getVolume(): number {
    return this.volume;
  }

  public setMuted(muted: boolean) {
    this.muted = muted;
    if (this.masterGain) {
      this.masterGain.gain.setValueAtTime(muted ? 0 : this.volume, this.ctx?.currentTime || 0);
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  public registerDmxSound(sound: DmxSound) {
    if (!this.ctx) this.initContext();
    if (!this.ctx) return;

    // Resample / create direct PCM AudioBuffer
    const audioBuffer = this.ctx.createBuffer(1, sound.samples.length, sound.sampleRate);
    const channelData = audioBuffer.getChannelData(0);
    channelData.set(sound.samples);
    this.dmxSoundCache.set(sound.name.toUpperCase(), audioBuffer);
  }

  /**
   * Plays a sound effect with 8-channel voice allocation, 80ms cooldown & priority preemption.
   * Priority: 1 = Critical (Error/Oof, Teleport), 2 = Milestone (Shotgun, Pickup), 3 = UI (Door, Click)
   */
  public playSound(type: SoundEffectType | string, priority: number = 2) {
    if (this.muted) return;
    if (!this.ctx) this.initContext();
    if (!this.ctx || this.ctx.state === 'suspended') {
      this.ctx?.resume();
    }
    if (!this.ctx || !this.masterGain) return;

    const now = Date.now();
    const soundKey = type.toString().toUpperCase();

    // 80ms Cooldown check
    const lastTrigger = this.lastTriggerTimes.get(soundKey) || 0;
    if (now - lastTrigger < 80) {
      return;
    }
    this.lastTriggerTimes.set(soundKey, now);

    // 8-Channel Voice Allocation: Find free channel or evict lowest priority voice
    let targetChannelIdx = -1;
    let lowestPriority = 999;
    let oldestTime = Infinity;
    let lowestPriorityIdx = -1;

    for (let i = 0; i < 8; i++) {
      const voice = this.voices[i];
      if (!voice) {
        targetChannelIdx = i;
        break;
      }
      if (voice.priority < lowestPriority || (voice.priority === lowestPriority && voice.startedAt < oldestTime)) {
        lowestPriority = voice.priority;
        oldestTime = voice.startedAt;
        lowestPriorityIdx = i;
      }
    }

    if (targetChannelIdx === -1) {
      // Check if new sound has higher/equal priority to evict
      if (priority >= lowestPriority && lowestPriorityIdx !== -1) {
        targetChannelIdx = lowestPriorityIdx;
        const evicted = this.voices[targetChannelIdx];
        if (evicted) {
          try {
            evicted.source.stop();
            evicted.source.disconnect();
          } catch {
            // Ignore if already ended
          }
          this.voices[targetChannelIdx] = null;
        }
      } else {
        // Drop sound if all 8 channels are busy with higher priority
        return;
      }
    }

    // Check if we have registered WAD DMX buffer
    const cachedBuffer = this.dmxSoundCache.get(soundKey) || this.dmxSoundCache.get(`DS${soundKey}`);
    if (cachedBuffer) {
      this.playBuffer(cachedBuffer, targetChannelIdx, soundKey, priority);
    } else {
      // Fallback to procedural retro synthesizer
      this.playProceduralSound(type as SoundEffectType, targetChannelIdx, priority);
    }
  }

  private playBuffer(buffer: AudioBuffer, channelIdx: number, id: string, priority: number) {
    if (!this.ctx || !this.masterGain) return;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;

    const gain = this.ctx.createGain();
    gain.gain.value = 1.0;

    source.connect(gain);
    gain.connect(this.masterGain);

    this.voices[channelIdx] = {
      id,
      source,
      gainNode: gain,
      priority,
      startedAt: Date.now(),
    };

    source.onended = () => {
      if (this.voices[channelIdx]?.source === source) {
        this.voices[channelIdx] = null;
      }
    };

    source.start(0);
  }

  /**
   * High-fidelity procedural retro sound synthesizer
   */
  private playProceduralSound(type: SoundEffectType, channelIdx: number, priority: number) {
    if (!this.ctx || !this.masterGain) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;

    switch (type) {
      case 'shotgun': {
        // Retro Shotgun: initial transient crack + white noise blast + pump click
        const bufferSize = ctx.sampleRate * 0.35;
        const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.08));
        }

        const noise = ctx.createBufferSource();
        noise.buffer = noiseBuffer;

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(2400, now);
        filter.frequency.exponentialRampToValueAtTime(300, now + 0.35);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.9, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);

        this.voices[channelIdx] = {
          id: 'shotgun',
          source: noise,
          gainNode: gain,
          priority,
          startedAt: Date.now(),
        };
        noise.start(now);
        break;
      }

      case 'pickup': {
        // Retro Item Pickup chime: high arpeggio 880Hz -> 1320Hz -> 1760Hz
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.setValueAtTime(1320, now + 0.06);
        osc.frequency.setValueAtTime(1760, now + 0.12);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);

        osc.connect(gain);
        gain.connect(this.masterGain);

        const dummySource = osc as unknown as AudioBufferSourceNode;
        this.voices[channelIdx] = {
          id: 'pickup',
          source: dummySource,
          gainNode: gain,
          priority,
          startedAt: Date.now(),
        };
        osc.start(now);
        osc.stop(now + 0.25);
        break;
      }

      case 'oof': {
        // Retro Oof / Damage grunt: pitch drop 180Hz -> 40Hz
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(180, now);
        osc.frequency.exponentialRampToValueAtTime(45, now + 0.22);

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(600, now);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.8, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.22);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);

        const dummySource = osc as unknown as AudioBufferSourceNode;
        this.voices[channelIdx] = {
          id: 'oof',
          source: dummySource,
          gainNode: gain,
          priority,
          startedAt: Date.now(),
        };
        osc.start(now);
        osc.stop(now + 0.22);
        break;
      }

      case 'door': {
        // Retro Sliding steel door: low rumbling FM sweep
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(80, now);
        osc.frequency.linearRampToValueAtTime(160, now + 0.4);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.5, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.45);

        osc.connect(gain);
        gain.connect(this.masterGain);

        const dummySource = osc as unknown as AudioBufferSourceNode;
        this.voices[channelIdx] = {
          id: 'door',
          source: dummySource,
          gainNode: gain,
          priority,
          startedAt: Date.now(),
        };
        osc.start(now);
        osc.stop(now + 0.45);
        break;
      }

      case 'teleport': {
        // Retro Teleport / God Mode: resonant sci-fi sweep
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.exponentialRampToValueAtTime(2400, now + 0.3);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.6, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);

        osc.connect(gain);
        gain.connect(this.masterGain);

        const dummySource = osc as unknown as AudioBufferSourceNode;
        this.voices[channelIdx] = {
          id: 'teleport',
          source: dummySource,
          gainNode: gain,
          priority,
          startedAt: Date.now(),
        };
        osc.start(now);
        osc.stop(now + 0.35);
        break;
      }

      case 'click':
      default: {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1200, now);
        osc.frequency.exponentialRampToValueAtTime(200, now + 0.03);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.03);

        osc.connect(gain);
        gain.connect(this.masterGain);

        const dummySource = osc as unknown as AudioBufferSourceNode;
        this.voices[channelIdx] = {
          id: 'click',
          source: dummySource,
          gainNode: gain,
          priority,
          startedAt: Date.now(),
        };
        osc.start(now);
        osc.stop(now + 0.03);
        break;
      }
    }
  }
}

export const audioEngine = AudioEngine.getInstance();
