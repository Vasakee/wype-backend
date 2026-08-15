import { Module } from '@nestjs/common';
import { SpeechService } from './speech.service';
import { VoiceService } from './voice.service';

@Module({
  providers: [SpeechService, VoiceService],
  exports: [SpeechService, VoiceService],
})
export class VoiceModule {}
