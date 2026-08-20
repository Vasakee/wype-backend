import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as webpush from 'web-push';
import {
  PushSubscription,
  PushSubscriptionDocument,
} from './push.schema';

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly vapidConfigured: boolean;

  constructor(
    @InjectModel(PushSubscription.name)
    private readonly subModel: Model<PushSubscriptionDocument>,
    private readonly configService: ConfigService,
  ) {
    const publicKey = this.configService.get<string>('VAPID_PUBLIC_KEY');
    const privateKey = this.configService.get<string>('VAPID_PRIVATE_KEY');
    const subject = this.configService.get<string>('VAPID_SUBJECT');

    if (publicKey && privateKey && subject) {
      webpush.setVapidDetails(subject, publicKey, privateKey);
      this.vapidConfigured = true;
      this.logger.log('Web-push VAPID configured');
    } else {
      this.vapidConfigured = false;
      this.logger.warn(
        'Web-push VAPID not configured — push notifications disabled',
      );
    }
  }

  async subscribe(
    userId: string,
    subscription: { endpoint: string; p256dh: string; auth: string },
  ): Promise<{ ok: boolean }> {
    if (!this.vapidConfigured) return { ok: false };

    await this.subModel.findOneAndUpdate(
      { endpoint: subscription.endpoint },
      {
        userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.p256dh,
        auth: subscription.auth,
      },
      { upsert: true, new: true },
    );

    return { ok: true };
  }

  async unsubscribe(endpoint: string): Promise<{ ok: boolean }> {
    await this.subModel.deleteOne({ endpoint });
    return { ok: true };
  }

  async getSubscriptions(userId: string): Promise<PushSubscriptionDocument[]> {
    return this.subModel.find({ userId }).lean().exec();
  }

  async sendToUser(
    userId: string,
    payload: { title: string; body: string; url?: string },
  ): Promise<void> {
    if (!this.vapidConfigured) return;

    const subs = await this.getSubscriptions(userId);
    if (subs.length === 0) return;

    const jsonPayload = JSON.stringify(payload);
    const deadEndpoints: string[] = [];

    await Promise.allSettled(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            jsonPayload,
          );
        } catch (err: unknown) {
          const status =
            err instanceof webpush.WebPushError ? err.statusCode : null;
          if (status === 404 || status === 410) {
            deadEndpoints.push(sub.endpoint);
          } else {
            this.logger.error(
              `Push failed for ${sub.endpoint.slice(0, 40)}…`,
              err instanceof Error ? err.message : String(err),
            );
          }
        }
      }),
    );

    if (deadEndpoints.length > 0) {
      await this.subModel.deleteMany({ endpoint: { $in: deadEndpoints } });
    }
  }
}
