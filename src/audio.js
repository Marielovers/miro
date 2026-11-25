const BASE = import.meta.env?.BASE_URL ?? '/';
const HIT = new Set(['HitArealeft', 'HitArearight', 'HitAreariibbon']);
export const voiceGroup = hit => HIT.has(hit) ? 'Hit' : 'Hmm';
export const voicePath = (hit, index) => `${BASE}audio/Voice_Miro_${voiceGroup(hit)}${index}.wav`;
export class GameAudio {
  constructor() {
    this.bgm = new Audio();
    this.bgm.src = this.bgm.canPlayType('audio/ogg; codecs="vorbis"') ? `${BASE}audio/BGM_Crayon.ogg` : `${BASE}audio/BGM_Crayon.mp3`;
    this.bgm.loop = true;
    this.bgm.volume = 0.35;
    this.bgm.preload = 'auto';
    this.voice = new Audio();
    this.voice.volume = 0.75;
    this.enabled = false;
    this.context = null;
    this.source = null;
    this.sequence = 0;
    this.buffers = new Map();
    // Prefetch the six short voice clips while the title screen is visible.
    for (const hit of ['HitArealeft','HitAreahead']) for (let i=1;i<=3;i++) {
      const path = voicePath(hit,i);
      this.buffers.set(path, fetch(path).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${path}`);
        return r.arrayBuffer();
      }).catch(error => { console.warn('[Audio] preload:', error); return null; }));
    }
  }
  start() {
    this.enabled = true;
    this.bgm.play().catch(error => console.warn('[Audio] BGM:', error));
    // Unlock Web Audio inside the start click; subsequent touch pointerdowns
    // need not independently satisfy browser autoplay restrictions.
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (Context) try {
      this.context ??= new Context();
      this.context.resume().catch(error => console.warn('[Audio] unlock:', error));
    } catch (error) { console.warn('[Audio] WebAudio:', error); }
  }
  playHitArea(hit) {
    if (!this.enabled) return;
    const path = voicePath(hit, 1 + Math.floor(Math.random() * 3));
    const sequence = ++this.sequence;
    this.voice.pause();
    if (this.source) { try { this.source.stop(); } catch {} this.source = null; }
    if (!this.context) { this.playFallback(path); return; }
    const context = this.context;
    Promise.resolve(this.buffers.get(path)).then(bytes => {
      if (!bytes) throw new Error(`Voice unavailable: ${path}`);
      return context.decodeAudioData(bytes.slice(0));
    }).then(buffer => {
      if (!this.enabled || sequence !== this.sequence) return;
      const source = context.createBufferSource();
      const gain = context.createGain();
      gain.gain.value = 0.75;
      source.buffer = buffer;
      source.connect(gain).connect(context.destination);
      this.source = source;
      source.onended = () => { if (this.source === source) this.source = null; source.disconnect(); gain.disconnect(); };
      source.start();
    }).catch(error => {
      console.warn('[Audio] Voice:', error);
      if (this.enabled && sequence === this.sequence) this.playFallback(path);
    });
  }
  playFallback(path) {
    this.voice.src = path;
    this.voice.play().catch(error => console.warn('[Audio] Voice fallback:', error));
  }
  stop() {
    this.enabled = false; ++this.sequence;
    this.bgm.pause(); this.voice.pause();
    if (this.source) { try { this.source.stop(); } catch {} this.source = null; }
  }
}
