import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Speech-to-text service. Mock by default so the voice flow can be exercised
 * in development: set MOCK_VOICE_TRANSCRIPT to the phrase a recorded voice note
 * should "say" (e.g. "Send 10 QUAI to basil.quai"). Set OPENAI_API_KEY to route
 * through the real Whisper transcription API.
 */
@Injectable()
export class SpeechService {
  private readonly logger = new Logger(SpeechService.name);

  constructor(private readonly configService: ConfigService) {}

  async transcribe(audio: Buffer, mimeType?: string): Promise<string> {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (apiKey) {
      return this.transcribeWithWhisper(audio, mimeType ?? 'audio/ogg');
    }

    this.logger.log(
      `[mock-stt] transcribed ${audio.length} bytes of audio (${mimeType ?? 'unknown'})`,
    );
    return this.configService.get<string>('MOCK_VOICE_TRANSCRIPT') ?? '';
  }

  /** Sends the audio to the Whisper API and returns the transcript text. */
  private async transcribeWithWhisper(
    audio: Buffer,
    mimeType: string,
  ): Promise<string> {
    const apiKey = this.configService.getOrThrow<string>('OPENAI_API_KEY');

    const formData = new FormData();
    const extension = mimeType.startsWith('audio/mp4')
      ? 'm4a'
      : mimeType.startsWith('audio/mpeg')
        ? 'mp3'
        : 'ogg';
    formData.append(
      'file',
      new Blob([new Uint8Array(audio)], { type: mimeType }),
      `voice.${extension}`,
    );
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'text');

    const response = await fetch(
      'https://api.openai.com/v1/audio/transcriptions',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
      },
    );
    if (!response.ok) {
      throw new Error(`Whisper transcription failed (${response.status})`);
    }

    return (await response.text()).trim();
  }
}
