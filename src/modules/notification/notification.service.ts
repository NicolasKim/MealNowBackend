import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as apn from '@parse/node-apn';
import * as path from 'path';
import * as fs from 'fs';
import { User, UserDocument } from '../auth/schemas/user.schema';

@Injectable()
export class NotificationService {
  private apnProvider?: apn.Provider;
  private readonly logger = new Logger(NotificationService.name);
  private readonly bundleId: string;

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>
  ) {
    // Attempt to load APNs configuration
    // In a real scenario, these should be in environment variables
    const keyId = process.env.APNS_KEY_ID || 'U856VG76WZ';
    const teamId = process.env.APNS_TEAM_ID || 'YOUR_TEAM_ID'; // Need to be replaced or set in env
    const keyPath = process.env.APNS_KEY_PATH || path.join(process.cwd(), 'resources', `AuthKey_${keyId}.p8`);
    this.bundleId = process.env.APNS_BUNDLE_ID || 'com.cuisine.app'; // Need to check actual bundle ID

    if (fs.existsSync(keyPath)) {
      try {
        this.apnProvider = new apn.Provider({
          token: {
            key: keyPath,
            keyId: keyId,
            teamId: teamId,
          },
          production: process.env.NODE_ENV === 'production',
        });
        this.logger.log('APNs Provider initialized successfully');
      } catch (error) {
        this.logger.error('Failed to initialize APNs Provider', error);
      }
    } else {
        this.logger.warn(`APNs key not found at ${keyPath}. Notifications will not be sent.`);
    }
  }

  async sendNotification(deviceTokens: string[], title: string, body: string, data?: any) {
    if (!this.apnProvider || !deviceTokens || deviceTokens.length === 0) {
      return;
    }

    const note = new apn.Notification();
    note.expiry = Math.floor(Date.now() / 1000) + 3600; // Expires 1 hour from now.
    note.badge = 1;
    note.sound = 'ping.aiff';
    note.alert = {
        title,
        body
    };
    note.payload = data || {};
    note.topic = this.bundleId;

    try {
      const result = await this.apnProvider.send(note, deviceTokens);
      
      if (result.failed.length > 0) {
        this.logger.error(`Failed to send notifications: ${JSON.stringify(result.failed)}`);
        
        // Cleanup invalid tokens
        const invalidTokens = result.failed
            .filter(f => f.status === 410 || f.response?.reason === 'Unregistered' || f.response?.reason === 'BadDeviceToken')
            .map(f => f.device);

        if (invalidTokens.length > 0) {
            this.logger.log(`Removing ${invalidTokens.length} invalid tokens`);
            try {
                await this.userModel.updateMany(
                    { deviceTokens: { $in: invalidTokens } },
                    { $pull: { deviceTokens: { $in: invalidTokens } } }
                );
            } catch (err) {
                this.logger.error('Failed to remove invalid tokens', err);
            }
        }
      }
      
      if (result.sent.length > 0) {
        this.logger.log(`Sent ${result.sent.length} notifications`);
      }
      
      return result;
    } catch (error) {
      this.logger.error('Error sending APNs notification', error);
      throw error;
    }
  }
}
