import { Controller, Post, Body, Logger, HttpCode, InternalServerErrorException } from '@nestjs/common';
import { BillingService } from '../billing/billing.service';
import * as fs from 'fs';
import * as path from 'path';
import { SignedDataVerifier, Environment, VerificationException } from '@apple/app-store-server-library';

@Controller('webhooks/app-store')
export class AppStoreWebhookController {
  private readonly logger = new Logger(AppStoreWebhookController.name);
  private rootCertificates: Buffer[] = [];

  constructor(private readonly billing: BillingService) {
    this.loadRootCertificates();
  }

  private loadRootCertificates() {
    try {
      const certDir = path.join(process.cwd(), 'src/certs');
      const files = [
        'AppleIncRootCertificate.pem',
        'AppleComputerRootCertificate.pem',
        'AppleRootCA-G2.pem',
        'AppleRootCA-G3.pem'
      ];

      this.rootCertificates = files.map(file => fs.readFileSync(path.join(certDir, file)));
      this.logger.log(`Loaded ${this.rootCertificates.length} Apple Root CA certificates for verification.`);
    } catch (e) {
      this.logger.error('Failed to load Apple Root CA certificates', e);
    }
  }

  @Post('sandbox')
  @HttpCode(200)
  async handleSandboxWebhook(@Body() body: any) {
    return this.processWebhook(body, Environment.SANDBOX);
  }

  @Post('production')
  @HttpCode(200)
  async handleProductionWebhook(@Body() body: any) {
    return this.processWebhook(body, Environment.PRODUCTION);
  }

  @Post()
  @HttpCode(200)
  async handleDefaultWebhook(@Body() body: any) {
    this.logger.warn('Received webhook on default route. Treating as Production. Please update App Store Connect to use /production or /sandbox explicitly.');
    return this.processWebhook(body, Environment.PRODUCTION);
  }

  private async processWebhook(body: any, environment: Environment) {
    // Apple sends { signedPayload: "..." }
    if (!body.signedPayload) {
      this.logger.warn('Received webhook without signedPayload');
      return { ok: false, reason: 'Missing signedPayload' };
    }

    try {
      this.logger.log(`Processing Webhook. Verifier: ${environment}`);

      // Initialize Verifier
      const bundleId = process.env.BUNDLE_ID || 'com.dreamtracer.todaysmeal';
      const appAppleId = process.env.APP_STORE_APP_ID ? parseInt(process.env.APP_STORE_APP_ID, 10) : undefined;
      const enableOnlineChecks = process.env.NODE_ENV === 'production';
      
      const verifier = new SignedDataVerifier(
        this.rootCertificates,
        enableOnlineChecks,
        environment,
        bundleId,
        appAppleId
      );

      // Verify and Decode
      const payload = await verifier.verifyAndDecodeNotification(body.signedPayload);

      this.logger.log(`Verified App Store Notification: ${payload.notificationType} ${payload.subtype || ''}`);

      if (!payload.data) {
        return { ok: true };
      }

      let transactionInfo: any = null;
      if (payload.data.signedTransactionInfo) {
        transactionInfo = await verifier.verifyAndDecodeTransaction(payload.data.signedTransactionInfo);
      }

      // Also check renewal info
      let renewalInfo: any = null;
      if (payload.data.signedRenewalInfo) {
        renewalInfo = await verifier.verifyAndDecodeRenewalInfo(payload.data.signedRenewalInfo);
        this.logger.log('Renewal info:', JSON.stringify(renewalInfo));
      }

      if (!transactionInfo) {
        this.logger.warn('Missing transaction info in verified payload');
        return { ok: true };
      }

      const { originalTransactionId, expiresDate, productId } = transactionInfo;
      this.logger.log(`Processing Verified Transaction: ${originalTransactionId} (${productId}) ${expiresDate}`);

      // Handle Notification Types
      await this.processNotification(
        payload.notificationType as string,
        payload.subtype as string | undefined,
        transactionInfo,
        renewalInfo
      );

      return { ok: true };

    } catch (e: any) {
      if (e instanceof VerificationException) {
        this.logger.error(`App Store Verification Failed: ${e.message}`, e.stack);
        // Do NOT throw. Return 200 to acknowledge receipt of invalid/fraudulent webhook.
        return { ok: true, warning: 'Verification failed' };
      }

      // For other errors (DB, logic), Rethrow to trigger Apple Retry
      this.logger.error('Error processing App Store webhook', e.message);
      throw new InternalServerErrorException(e.message);
    }
  }

  private async processNotification(notificationType: string, subtype: string | undefined, transactionInfo: any, renewalInfo: any) {
    const { originalTransactionId, expiresDate, productId } = transactionInfo;

    switch (notificationType) {
      case 'SUBSCRIBED':
      case 'DID_RENEW':
        await this.billing.updateAppStoreSubscriptionStatus(
          originalTransactionId,
          'active',
          expiresDate,
          productId
        );
        break;

      case 'EXPIRED':
        await this.billing.updateAppStoreSubscriptionStatus(
          originalTransactionId,
          'expired'
        );
        break;

      case 'DID_FAIL_TO_RENEW':
        await this.billing.updateAppStoreSubscriptionStatus(
          originalTransactionId,
          'past_due'
        );
        break;

      case 'REFUND':
      case 'REVOKED':
        await this.billing.updateAppStoreSubscriptionStatus(
          originalTransactionId,
          'revoked'
        );
        break;

      case 'DID_CHANGE_RENEWAL_STATUS':
        // Correctly handle user enabling/disabling auto-renew.
        // If autoRenewStatus is 0 (off), database will update autoRenew: false.
        // This triggers "Canceled (Active)" in the app UI.
        if (renewalInfo) {
          console.log('Renewal info:', JSON.stringify(renewalInfo));
          const autoRenewStatus = renewalInfo.autoRenewStatus === 1; // 1 = On, 0 = Off
          await this.billing.updateAppStoreAutoRenewStatus(
            originalTransactionId,
            autoRenewStatus
          );
        }
        break;

      case 'DID_CHANGE_RENEWAL_PREF':
        await this.billing.updateAppStoreAutoRenewStatus(
          originalTransactionId,
          true
        );
        break;

      default:
        this.logger.debug(`Unhandled notification type: ${notificationType}`);
        break;
    }
  }
}
