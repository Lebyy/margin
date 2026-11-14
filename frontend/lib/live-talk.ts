// Talk, in the browser.
//
// The microphone is turned into 16 kHz PCM and sent to our API. The API holds
// the key and the answer. It starts playback once the transcript so far is
// clean, and a later hit stops it. This file plays that audio. It does not
// call Gemini itself.

import { API_BASE } from "@/lib/api";

export type LiveCaption = { role: "student" | "tutor"; text: string; speak: boolean; partial: boolean };

/**
 * Puts a live caption into the thread.
 * While `live` is set, a later caption for that same side replaces the text instead of adding a line. The bubble stays one line that grows as the words arrive.
 */
export function placeCaption<T extends { role: "student" | "tutor"; content: string; live?: boolean }>(turns: T[], next: T): T[] {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].live && turns[i].role === next.role) {
      const copy = turns.slice();
      copy[i] = { ...turns[i], content: next.content, live: next.live };
      return copy;
    }
  }
  return [...turns, next];
}

const WORKLET = `
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      const copy = new Float32Array(channel.length);
      copy.set(channel);
      this.port.postMessage({ samples: copy, rate: sampleRate });
    }
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
`;

/** 16-bit little-endian PCM at 16 kHz, which is the rate the live model expects. */
function toPcm16k(samples: Float32Array, rate: number): ArrayBuffer {
  const outRate = 16000;
  const ratio = rate / outRate;
  const length = Math.max(1, Math.floor(samples.length / ratio));
  const pcm = new Int16Array(length);
  for (let i = 0; i < length; i++) {
    const pos = i * ratio;
    const left = Math.floor(pos);
    const right = Math.min(left + 1, samples.length - 1);
    const sample = samples[left] + (samples[right] - samples[left]) * (pos - left);
    const clamped = Math.max(-1, Math.min(1, sample));
    pcm[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return pcm.buffer;
}

/**
 * Opens one Talk session and returns a function that hangs up.
 * The microphone starts only after the server says the model session is ready, so a refused session never asks for the mic.
 */
export function startLive(
  sessionId: string,
  handlers: {
    onCaption: (caption: LiveCaption) => void;
    onError: (message: string) => void;
    onEnd: () => void;
  },
): Promise<() => void> {
  const url = new URL(API_BASE);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/api/live";
  url.searchParams.set("session", sessionId);

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    let settled = false;
    // Created during the click, then resumed, so the first reply is not stuck behind a suspended audio device.
    const playback = new AudioContext({ sampleRate: 24000 });
    void playback.resume();
    let playAt = 0;
    const sources: AudioBufferSourceNode[] = [];
    let stopMic: (() => void) | null = null;

    function fail(message: string) {
      if (settled) handlers.onError(message);
      else reject(new Error(message));
      hangup();
    }

    function stopPlayback() {
      for (const source of sources) {
        try {
          source.stop();
        } catch {
          // Already stopped.
        }
      }
      sources.length = 0;
      playAt = 0;
    }

    function play(pcm: ArrayBuffer) {
      if (playback.state === "suspended") void playback.resume();
      const view = new Int16Array(pcm);
      const floats = new Float32Array(view.length);
      for (let i = 0; i < view.length; i++) floats[i] = view[i] / 32768;
      const buffer = playback.createBuffer(1, floats.length, 24000);
      buffer.copyToChannel(floats, 0);
      const source = playback.createBufferSource();
      source.buffer = buffer;
      source.connect(playback.destination);
      const start = Math.max(playback.currentTime + 0.02, playAt);
      source.start(start);
      playAt = start + buffer.duration;
      sources.push(source);
    }

    function hangup() {
      stopPlayback();
      stopMic?.();
      stopMic = null;
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "hangup" }));
        socket.close();
      } else if (socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
      void playback.close();
      handlers.onEnd();
    }

    const giveUp = window.setTimeout(() => fail("Voice is not available right now."), 15000);

    socket.onerror = () => fail("Voice is not available right now.");
    socket.onclose = () => {
      window.clearTimeout(giveUp);
      if (!settled) fail("Voice is not available right now.");
      else handlers.onEnd();
    };
    socket.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        play(event.data);
        return;
      }
      let message: { type?: string; error?: string; role?: "student" | "tutor"; text?: string; speak?: boolean; partial?: boolean };
      try {
        message = JSON.parse(String(event.data)) as typeof message;
      } catch {
        return;
      }
      if (message.type === "error") {
        window.clearTimeout(giveUp);
        fail(message.error === "session_not_found" ? "Start a session first." : "Voice is not available right now.");
        return;
      }
      if (message.type === "stop") {
        stopPlayback();
        return;
      }
      if (message.type === "caption" && message.role && message.text) {
        handlers.onCaption({ role: message.role, text: message.text, speak: Boolean(message.speak), partial: Boolean(message.partial) });
        if (message.speak && "speechSynthesis" in window) {
          window.speechSynthesis.speak(new SpeechSynthesisUtterance(message.text));
        }
        return;
      }
      if (message.type !== "ready") return;
      window.clearTimeout(giveUp);
      void startMic(socket)
        .then((stop) => {
          stopMic = stop;
          settled = true;
          resolve(() => hangup());
        })
        .catch(() => fail("The microphone is blocked."));
    };
  });
}

async function startMic(socket: WebSocket): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const context = new AudioContext();
  void context.resume();
  const blob = new Blob([WORKLET], { type: "application/javascript" });
  const workletUrl = URL.createObjectURL(blob);
  await context.audioWorklet.addModule(workletUrl);
  URL.revokeObjectURL(workletUrl);
  const source = context.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(context, "pcm-capture");
  const mute = context.createGain();
  mute.gain.value = 0;
  node.port.onmessage = (event: MessageEvent<{ samples: Float32Array; rate: number }>) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(toPcm16k(event.data.samples, event.data.rate));
  };
  source.connect(node);
  node.connect(mute);
  mute.connect(context.destination);
  return () => {
    stream.getTracks().forEach((track) => track.stop());
    void context.close();
  };
}
