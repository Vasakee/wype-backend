import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SpeechService } from './speech.service';

/**
 * Handles a Twilio voice-note media URL: downloads the audio (Twilio media
 * endpoints require Basic auth) and runs it through the SpeechService.
 * If the download fails — e.g. Twilio is not configured yet — it falls back
 * to whatever transcript SpeechService returns in mock mode.
 */
@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly speechService: SpeechService,
  ) {}

  async transcribeVoiceNote(
    mediaUrl: string,
    mimeType?: string,
  ): Promise<string> {
    let audio: Buffer;
    try {
      audio = await this.downloadAudio(mediaUrl);
    } catch (error) {
      this.logger.warn(
        `Failed to download voice note ${mediaUrl}, falling back to mock transcription`,
        error as Error,
      );
      audio = Buffer.alloc(0);
    }

    return this.speechService.transcribe(audio, mimeType);
  }

  private async downloadAudio(mediaUrl: string): Promise<Buffer> {
    const sid = this.configService.getOrThrow<string>('TWILIO_ACCOUNT_SID');
    const token = this.configService.getOrThrow<string>('TWILIO_AUTH_TOKEN');
    const authorization = `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;

    const response = await fetch(mediaUrl, {
      headers: { Authorization: authorization },
    });
    if (!response.ok) {
      throw new Error(`Failed to download voice note (${response.status})`);
    }

    return Buffer.from(await response.arrayBuffer());
  }
}
