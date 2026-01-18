import { Controller, Post, Body, Logger, HttpCode, Headers, UnauthorizedException } from '@nestjs/common';
import { BillingService } from '../billing/billing.service';

@Controller('webhooks/revenue-cat')
export class RevenueCatWebhookController {
  private readonly logger = new Logger(RevenueCatWebhookController.name);

  constructor(private readonly billing: BillingService) {}

  @Post()
  @HttpCode(200)
  async handleWebhook(@Body() body: any, @Headers('authorization') authHeader: string) {
    // 1. Authorization Check (Optional but recommended)
    // Configure this token in RevenueCat Dashboard -> Project Settings -> Integrations -> Webhooks
    const expectedToken = process.env.REVENUECAT_WEBHOOK_AUTH_TOKEN;
    if (expectedToken && authHeader !== expectedToken) {
      this.logger.warn(`Unauthorized Webhook attempt. Header: ${authHeader}`);
      throw new UnauthorizedException('Invalid authorization token');
    }

    const { event } = body;
    if (!event) {
      this.logger.warn('Received webhook without event data');
      return { ok: false, reason: 'Missing event' };
    }

    const { type, app_user_id, original_transaction_id, product_id, expiration_at_ms } = event;
    
    this.logger.log(`Received RevenueCat Event: ${type} for User: ${app_user_id}`);

    try {
      switch (type) {
        case 'INITIAL_PURCHASE':
        case 'NON_RENEWING_PURCHASE': // e.g. Lifetime
          // Link user to subscription
          await this.billing.linkAppStoreSubscription(
            app_user_id,
            original_transaction_id,
            product_id,
            'active',
            expiration_at_ms,
            true // Assuming auto-renew is on for subscriptions initially
          );
          break;

        case 'RENEWAL':
        case 'PRODUCT_CHANGE':
          await this.billing.updateAppStoreSubscriptionStatus(
            original_transaction_id,
            'active',
            expiration_at_ms,
            product_id
          );
          break;

        case 'CANCELLATION':
          // This event means auto-renew was turned off, NOT immediate expiration
          await this.billing.updateAppStoreAutoRenewStatus(
            original_transaction_id,
            false
          );
          break;

        case 'UNCANCELLATION':
          // Auto-renew turned back on
          await this.billing.updateAppStoreAutoRenewStatus(
            original_transaction_id,
            true
          );
          break;

        case 'EXPIRATION':
          // Subscription actually expired
          await this.billing.updateAppStoreSubscriptionStatus(
            original_transaction_id,
            'expired'
          );
          break;

        case 'BILLING_ISSUE':
          await this.billing.updateAppStoreSubscriptionStatus(
            original_transaction_id,
            'past_due'
          );
          break;
        
        case 'TEST':
            this.logger.log('RevenueCat Test Webhook received successfully');
            break;

        default:
          this.logger.debug(`Unhandled RevenueCat event type: ${type}`);
          break;
      }

      return { ok: true };
    } catch (e: any) {
      this.logger.error(`Error processing RevenueCat webhook: ${e.message}`, e.stack);
      // Return 200 to prevent RevenueCat from retrying indefinitely on logic errors
      // (unless it's a transient error, but for now we swallow it)
      return { ok: true, error: e.message };
    }
  }
}
