// 发音播放：优先用有道返回的真人音频，拿不到时回落到系统朗读。
// 与旧版 sidepanel.js 的 speak() 行为保持一致。

let currentAudio = null;

export function canSpeak(text) {
  const value = String(text || "").trim();
  return Boolean(value) && value.length <= 120;
}

export function audioUrlOf(audio = {}) {
  return audio?.us || audio?.uk || audio?.generic || "";
}

export function speak({ text, language, audio } = {}) {
  const value = String(text || "").trim();
  if (!canSpeak(value)) return false;
  stopSpeaking();
  const url = audioUrlOf(audio);
  if (url) {
    try {
      currentAudio = new Audio(url);
      currentAudio.play().catch(() => speakWithSystem(value, language));
      return true;
    } catch {
      return speakWithSystem(value, language);
    }
  }
  return speakWithSystem(value, language);
}

export function stopSpeaking() {
  if (currentAudio) {
    try { currentAudio.pause(); } catch {}
    currentAudio = null;
  }
  if (typeof speechSynthesis !== "undefined") {
    try { speechSynthesis.cancel(); } catch {}
  }
}

function speakWithSystem(text, language) {
  if (typeof speechSynthesis === "undefined") return false;
  try {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = String(language || "").toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
    utterance.rate = 0.92;
    speechSynthesis.speak(utterance);
    return true;
  } catch {
    return false;
  }
}