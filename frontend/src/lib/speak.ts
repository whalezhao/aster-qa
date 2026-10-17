/**
 * 平台内语音播报（浏览器 SpeechSynthesis）。
 *
 * 为什么不用服务端 TTS：这一版只求「在平台上把 AI 结论念出来」，浏览器自带的能力
 * 零成本、零延迟、不依赖外部服务。要发到 IM 语音消息是另一件事（需要服务端 TTS）。
 */

let current: SpeechSynthesisUtterance | null = null;

export function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/** Markdown 直接念会很吵，先剥掉标记。 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '（代码块略）')
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/^\s*[|>-]\s*/gm, '')
    .replace(/[#*_`~]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 念一段文字；返回是否真的开始播报。 */
export function speak(text: string, onEnd?: () => void): boolean {
  if (!canSpeak()) return false;
  const content = stripMarkdown(text);
  if (!content) return false;
  stopSpeaking();

  const utterance = new SpeechSynthesisUtterance(content);
  utterance.lang = 'zh-CN';
  utterance.rate = 1.02;
  const zhVoice = window.speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith('zh'));
  if (zhVoice) utterance.voice = zhVoice;
  utterance.onend = () => {
    current = null;
    onEnd?.();
  };
  utterance.onerror = () => {
    current = null;
    onEnd?.();
  };
  current = utterance;
  window.speechSynthesis.speak(utterance);
  return true;
}

export function stopSpeaking(): void {
  if (!canSpeak()) return;
  window.speechSynthesis.cancel();
  current = null;
}

export function isSpeaking(): boolean {
  return current !== null;
}
