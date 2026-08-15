import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { BlipController } from './blip/blip.controller';
import { BlipService } from './blip/blip.service';
import { EscrowController } from './escrow/escrow.controller';
import { EscrowService } from './escrow/escrow.service';
import { MovementController } from './movement/movement.controller';
import { MovementService } from './movement/movement.service';
import { TransferController } from './transfer/transfer.controller';
import { TransferService } from './transfer/transfer.service';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';
import { WalletController } from './wallet/wallet.controller';
import { WalletService } from './wallet/wallet.service';
import { WhatsappController } from './whatsapp/whatsapp.controller';
import { WhatsappService } from './whatsapp/whatsapp.service';

describe('Swagger document', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        AppController,
        AuthController,
        UsersController,
        WalletController,
        TransferController,
        WhatsappController,
        EscrowController,
        MovementController,
        BlipController,
      ],
      providers: [
        AppService,
        { provide: AuthService, useValue: {} },
        { provide: UsersService, useValue: {} },
        { provide: WalletService, useValue: {} },
        { provide: TransferService, useValue: {} },
        { provide: WhatsappService, useValue: {} },
        { provide: EscrowService, useValue: {} },
        { provide: MovementService, useValue: {} },
        { provide: BlipService, useValue: {} },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    const config = new DocumentBuilder()
      .setTitle('Wype API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    (app as unknown as { wypeSpec: typeof document }).wypeSpec = document;
  });

  afterAll(async () => {
    await app.close();
  });

  it('documents every endpoint', () => {
    const spec = (
      app as unknown as { wypeSpec: { paths: Record<string, unknown> } }
    ).wypeSpec;
    const paths = Object.keys(spec.paths);

    expect(paths).toEqual(
      expect.arrayContaining([
        '/api/health',
        '/api/auth/register',
        '/api/auth/verify-magic-link',
        '/api/auth/login',
        '/api/auth/pin',
        '/api/user/me',
        '/api/user/claim-username',
        '/api/wallet',
        '/api/transfer/email',
        '/api/transfer/whatsapp',
        '/api/transfer/history',
        '/api/transfer/claim-escrow',
        '/api/escrow/reverse-expired',
        '/api/movement/self-custody',
        '/api/blip/fund',
        '/api/blip/fund/{sessionId}',
        '/api/blip/price',
        '/api/whatsapp/webhook',
        '/api/whatsapp/send',
      ]),
    );
  });

  it('marks the JWT-guarded endpoints with bearer security', () => {
    const spec = (
      app as unknown as { wypeSpec: { paths: Record<string, unknown> } }
    ).wypeSpec;
    const email = spec.paths['/api/transfer/email'] as {
      post?: { security?: unknown[] };
    };
    const op = email.post;
    expect(op?.security).toEqual([{ bearer: [] }]);
  });
});
