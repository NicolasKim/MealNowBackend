import { Args, Mutation, Query, Resolver } from '@nestjs/graphql'
import { BillingService } from '../billing/billing.service'
import { AppStoreService } from './app-store.service'
import { UseGuards, Logger } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { UserDocument } from '../auth/schemas/user.schema'
import { I18nService } from 'nestjs-i18n'
import { CurrentClientInfo, ClientInfo } from '../../common/decorators/client-info.decorator'

const SUBSCRIPTION_PLANS = [
  {
    id: 'yearly',
    title: 'Yearly Plan',
    price: 150,
    currency: 'CNY',
    interval: 'year',
    description: 'Equivalent to ¥12.5/mo',
    iapSku: 'com.mealnow.premium.yearly',
    isPopular: false,
    isBestValue: true,
    savings: 'Save 17%',
    pricePerUnit: '¥12.5/mo',
  },
  {
    id: 'quarterly',
    title: 'Quarterly Plan',
    price: 40,
    currency: 'CNY',
    interval: 'quarter',
    description: '¥13.3/mo',
    iapSku: 'com.mealnow.premium.quarterly',
    isPopular: false,
    isBestValue: false,
    savings: null,
    pricePerUnit: '¥13.3/mo',
  },
  {
    id: 'monthly',
    title: 'Monthly Plan',
    price: 15,
    currency: 'CNY',
    interval: 'month',
    description: 'Flexible',
    iapSku: 'com.mealnow.premium.monthly',
    isPopular: false,
    isBestValue: false,
    savings: null,
    pricePerUnit: '¥15/mo',
  },
];

@Resolver()
export class PaymentResolver {
  private readonly logger = new Logger(PaymentResolver.name);

  constructor(
    private readonly billing: BillingService,
    private readonly appStore: AppStoreService,
    private readonly i18n: I18nService
  ) { }

  @Query('subscriptionPlans')
  async subscriptionPlans(@CurrentClientInfo() clientInfo: ClientInfo) {
    const lang = clientInfo.language;
    // Collect all IAP SKUs
    const skus = SUBSCRIPTION_PLANS.map(p => p.iapSku).filter(Boolean) as string[];

    // Fetch latest prices from App Store Connect (if configured)
    const appStorePrices = await this.appStore.getIapPrices(skus);

    // Find the base monthly price for savings calculation (default or fetched)
    const monthlyPlan = SUBSCRIPTION_PLANS.find(p => p.id === 'monthly');
    let baseMonthlyPrice = monthlyPlan?.price || 15;
    
    if (appStorePrices && appStorePrices.length > 0) {
      const monthlyMatch = appStorePrices.find(p => p.sku === monthlyPlan?.iapSku);
      if (monthlyMatch) {
        baseMonthlyPrice = parseFloat(monthlyMatch.price);
      }
    }

    return SUBSCRIPTION_PLANS.map(plan => {
      let price = plan.price;
      let currency = plan.currency;
      
      const match = appStorePrices?.find(p => p.sku === plan.iapSku);
      if (match) {
        price = parseFloat(match.price);
        currency = match.currency;
      }

      const currencySymbol = this.getCurrencySymbol(currency);
      const unitMonth = this.i18n.t('payment.common.unit_month', { lang });
      let pricePerUnit = '';
      let savings: string | null = null;
      let description = '';

      if (plan.interval === 'year') {
        const monthlyEquivalent = price / 12;
        const priceFormatted = `${currencySymbol}${monthlyEquivalent.toFixed(1)}`;
        pricePerUnit = `${priceFormatted}${unitMonth}`;
        description = this.i18n.t('payment.plans.yearly.description', { lang, args: { price: priceFormatted } });

        if (baseMonthlyPrice > 0) {
          const savingPercent = Math.round(((baseMonthlyPrice * 12 - price) / (baseMonthlyPrice * 12)) * 100);
          if (savingPercent > 0) {
            savings = this.i18n.t('payment.plans.yearly.savings', { lang, args: { percent: savingPercent } });
          }
        }
      } else if (plan.interval === 'quarter') {
        const monthlyEquivalent = price / 3;
        const priceFormatted = `${currencySymbol}${monthlyEquivalent.toFixed(1)}`;
        pricePerUnit = `${priceFormatted}${unitMonth}`;
        description = this.i18n.t('payment.plans.quarterly.description', { lang, args: { price: priceFormatted } });
      } else if (plan.interval === 'month') {
        const priceFormatted = `${currencySymbol}${price}`;
        pricePerUnit = `${priceFormatted}${unitMonth}`;
        description = this.i18n.t('payment.plans.monthly.description', { lang });
      }

      return {
        ...plan,
        title: this.i18n.t(`payment.plans.${plan.id}.title`, { lang }),
        price,
        currency,
        pricePerUnit,
        savings,
        description
      };
    });
  }

  private getCurrencySymbol(currency: string): string {
    const symbols: { [key: string]: string } = {
      'CNY': '¥',
      'USD': '$',
      'EUR': '€',
      'GBP': '£',
      'JPY': '¥',
      'AED': 'AED ' // Fallback for AED or just use code
    };
    return symbols[currency] || (currency + ' ');
  }

  @Mutation('verifyAppStoreReceipt')
  @UseGuards(JwtAuthGuard)
  async verifyAppStoreReceipt(
    @CurrentUser() user: UserDocument,
    @Args('receiptData') receiptData: string,
    @CurrentClientInfo() clientInfo: ClientInfo
  ) {
    this.logger.log(`verifyAppStoreReceipt called for user: ${user._id}`);
    const lang = clientInfo.language;
    
    // Ensure receiptData is a clean Base64 string (remove newlines if any)
    const cleanReceipt = receiptData.replace(/[\n\r]/g, '');

    // JWS Detection (StoreKit 2)
    if (cleanReceipt.split('.').length === 3) {
      this.logger.log('Detected JWS format. Verifying with StoreKit 2...');
      try {
        const tInfo = await this.appStore.verifyJWS(cleanReceipt);
        const { originalTransactionId, productId, expiresDate } = tInfo;
        
        // Map fields
        const original_transaction_id = originalTransactionId || '';
        const product_id = productId || '';
        // JWS expiresDate is usually number (ms) from the library, but let's ensure
        const expires_date_ms = expiresDate; 
        
        // StoreKit 2 JWS (transaction info) does not include autoRenewStatus.
        // Assuming true for immediate purchase verification.
        const autoRenewStatus = true;

        const now = Date.now();
        const expires = Number(expires_date_ms);
        const isValid = expires > now;
        
        this.logger.log(`Linking (JWS): User=${user._id}, TransID=${original_transaction_id}, Product=${product_id}, Expires=${expires_date_ms} ${isValid ? 'Valid' : 'Expired'}`);
        
        await this.billing.linkAppStoreSubscription(
          String(user._id),
          original_transaction_id,
          product_id,
          isValid ? 'active' : 'expired',
          expires,
          autoRenewStatus
        );
        
        this.logger.log('Subscription linked successfully (JWS)');
        return true;
        
      } catch (e: any) {
        this.logger.error(`JWS verification failed: ${e.message}`);
        throw new Error(this.i18n.t('payment.errors.jws_verification_failed', { lang, args: { message: e.message } }));
      }
    }
    
    // Legacy Verification (StoreKit 1)
    const data = await this.appStore.verifyReceipt(cleanReceipt);
    this.logger.log(`Apple verifyReceipt result status: ${data.status}`);

    if (data.status !== 0) {
      this.logger.error(`Receipt verification failed: ${JSON.stringify(data)}`);
      throw new Error(this.i18n.t('payment.errors.receipt_verification_failed', { lang }) + `: ${data.status}`);
    }

    // Get the latest transaction from latest_receipt_info
    // It's usually sorted, but let's be safe
    const latestInfo = data.latest_receipt_info
      ?.sort((a: any, b: any) => parseInt(b.expires_date_ms) - parseInt(a.expires_date_ms))[0];

    if (!latestInfo) {
      this.logger.error('No latest_receipt_info found in receipt data');
      throw new Error(this.i18n.t('payment.errors.no_subscription_info', { lang }));
    }

    const { original_transaction_id, product_id, expires_date_ms } = latestInfo;

    // Try to find auto_renew_status from pending_renewal_info
    let autoRenewStatus = latestInfo.auto_renew_status;

    if (data.pending_renewal_info && Array.isArray(data.pending_renewal_info)) {
      const renewalInfo = data.pending_renewal_info.find((r: any) =>
        r.product_id === product_id ||
        r.original_transaction_id === original_transaction_id
      );
      if (renewalInfo && renewalInfo.auto_renew_status) {
        autoRenewStatus = renewalInfo.auto_renew_status;
      }
    }

    const now = Date.now();
    const expires = parseInt(expires_date_ms);
    const isValid = expires > now;

    this.logger.log(`Linking subscription: User=${user._id}, TransID=${original_transaction_id}, Product=${product_id}, Expires=${expires_date_ms} ${isValid ? 'Valid' : 'Expired'} AutoRenew=${autoRenewStatus}`);

    // Always link the subscription, even if expired. 
    // This ensures that future webhooks (renewals) can find the user.
    await this.billing.linkAppStoreSubscription(
      String(user._id),
      original_transaction_id,
      product_id,
      isValid ? 'active' : 'expired',
      expires,
      autoRenewStatus === '1'
    );

    this.logger.log('Subscription linked successfully');

    return true;
  }


}
