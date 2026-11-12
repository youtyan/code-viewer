// エージェントが入力待ちになった・終わったときの短い音 (設定の「短い音も鳴らす」。
// 既定は鳴らさない)。音のファイルは持たず、Web Audio で 2 つの音の高さを鳴らす
// (入力待ちは上がる 2 音、終わったは 1 音)。
//
// 鳴らせない (Web Audio が無い・ブラウザが自動再生を止めている) ときは、理由を
// console に出す。画面には出さない (通知そのものは別に出ている)。

import type { AgentTransition } from "../../core/agent-overview";

/** 音の高さ (Hz) と長さ (秒)。 */
const TONES: Record<AgentTransition, readonly number[]> = {
  waiting: [660, 880],
  finished: [740],
};
const TONE_SECONDS = 0.12;
const VOLUME = 0.08;

/** 鳴らすのに使う分だけの AudioContext の形 (テストで差し替える)。 */
export type AudioContextLike = {
  state: string;
  currentTime: number;
  destination: unknown;
  resume(): Promise<void>;
  createOscillator(): {
    type: string;
    frequency: { setValueAtTime(value: number, at: number): unknown };
    connect(target: unknown): unknown;
    start(at: number): void;
    stop(at: number): void;
  };
  createGain(): {
    gain: {
      setValueAtTime(value: number, at: number): unknown;
      exponentialRampToValueAtTime(value: number, at: number): unknown;
    };
    connect(target: unknown): unknown;
  };
};

let context: AudioContextLike | null = null;

function audioContext(): AudioContextLike {
  if (context) return context;
  const Ctor = globalThis.AudioContext;
  if (typeof Ctor !== "function") {
    throw new Error("this browser has no Web Audio (AudioContext)");
  }
  context = new Ctor();
  return context;
}

/** 鳴らす。鳴らせなければ理由つきで投げる (呼び出し側が console に出す)。 */
export async function playAttentionSound(
  transition: AgentTransition,
  make: () => AudioContextLike = audioContext,
): Promise<void> {
  const audio = make();
  if (audio.state === "suspended") await audio.resume();
  const start = audio.currentTime;
  TONES[transition].forEach((frequency, index) => {
    const at = start + index * TONE_SECONDS;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, at);
    gain.gain.setValueAtTime(VOLUME, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + TONE_SECONDS);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start(at);
    oscillator.stop(at + TONE_SECONDS);
  });
}
