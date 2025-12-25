import { Controller, Post, Body, Logger, HttpCode, InternalServerErrorException } from '@nestjs/common';
import { BillingService } from '../billing/billing.service';
import * as jwt from 'jsonwebtoken';
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

  @Post()
  @HttpCode(200)
  async handleWebhook(@Body() body: any) {
    // Apple sends { signedPayload: "..." }
    if (!body.signedPayload) {
      this.logger.warn('Received webhook without signedPayload');
      return;
    }

    try {
      // 1. Peek at the payload to determine environment (Sandbox vs Production)
      // We use jwt.decode (unverified) just to check the 'environment' field securely verified later.
      const unverifiedPayload: any = jwt.decode(body.signedPayload);
      if (!unverifiedPayload) {
        this.logger.error('Failed to decode signedPayload (unverified step)');
        return;
      }

      const payloadEnv = unverifiedPayload.data?.environment;
      let environment = Environment.PRODUCTION;
      if (payloadEnv === 'Sandbox') {
        environment = Environment.SANDBOX;
      }

      this.logger.log(`Processing Webhook. Env: ${payloadEnv} -> Verifier: ${environment}`);

      // 2. Initialize Verifier
      const bundleId = process.env.BUNDLE_ID || 'com.dreamtracer.todaysmeal';
      const appAppleId = process.env.APP_STORE_APP_ID ? parseInt(process.env.APP_STORE_APP_ID, 10) : undefined;
      
      const verifier = new SignedDataVerifier(
        this.rootCertificates,
        true, // enableOnlineChecks (Checks OCSP / revocation)
        environment,
        bundleId,
        appAppleId
      );

      // 3. Verify and Decode
      const payload = await verifier.verifyAndDecodeNotification(body.signedPayload);

      this.logger.log(`Verified App Store Notification: ${payload.notificationType} ${payload.subtype || ''}`);

      if (!payload.data) {
        return;
      }

      // 4. Decode transaction info (also verified implicitly if inside a verified payload?)
      // Actually, verified payload contains raw jwt strings for signedTransactionInfo.
      // We need to verify those too or just decode if we trust the container? 
      // The library's `verifyAndDecodeNotification` returns `ResponseBodyV2DecodedPayload`.
      // The `data.signedTransactionInfo` is still a JWT string.
      // However, since the Notification JWT itself is signed by Apple, and contains the Transaction JWT,
      // creating a chain of trust is good, but usually we verify the inner ones too using `verifyAndDecodeTransaction`.
      // Let's be thorough.

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
        return;
      }

      const { originalTransactionId, expiresDate, productId } = transactionInfo;
      this.logger.log(`Processing Verified Transaction: ${originalTransactionId} (${productId}) ${expiresDate}`);

      // 5. Handle Notification Types
      await this.processNotification(
        payload.notificationType as string,
        payload.subtype as string | undefined,
        transactionInfo,
        renewalInfo
      );

    } catch (e: any) {
      if (e instanceof VerificationException) {
        this.logger.error(`App Store Verification Failed: ${e.message}`, e.stack);
        // Do NOT throw. Return 200 to acknowledge receipt of invalid/fraudulent webhook.
        return;
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
