import { useEffect, useState } from 'react';
import { Button, Tooltip } from 'antd';
import { SoundOutlined, StopOutlined } from '@ant-design/icons';
import { canSpeak, speak, stopSpeaking } from '../lib/speak';

/**
 * 把一段文字念出来。浏览器不支持 SpeechSynthesis 时按钮置灰并说明原因，
 * 而不是点了没反应。
 */
export default function SpeakButton({ text, size = 'small' }: { text: string; size?: 'small' | 'middle' }) {
  const supported = canSpeak();
  const [playing, setPlaying] = useState(false);

  useEffect(() => () => stopSpeaking(), []);

  if (!supported) {
    return (
      <Tooltip title="当前浏览器不支持语音播报">
        <Button size={size} icon={<SoundOutlined />} disabled>
          朗读
        </Button>
      </Tooltip>
    );
  }

  return (
    <Button
      size={size}
      icon={playing ? <StopOutlined /> : <SoundOutlined />}
      onClick={() => {
        if (playing) {
          stopSpeaking();
          setPlaying(false);
          return;
        }
        if (speak(text, () => setPlaying(false))) setPlaying(true);
      }}
    >
      {playing ? '停止' : '朗读'}
    </Button>
  );
}
