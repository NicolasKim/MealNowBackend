import { Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { I18nService } from 'nestjs-i18n'
import { Subscription, SubscriptionDocument } from './schemas/subscription.schema'
import { UsageRecord, UsageRecordDocument } from './schemas/usage-record.schema'

import { QuotaExceededError } from '../../common/errors/quota-exceeded.error'

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @InjectModel(Subscription.name) private readonly subscriptions: Model<SubscriptionDocument>,
    @InjectModel(UsageRecord.name) private readonly usageRecords: Model<UsageRecordDocument>,
    private readonly i18n: I18nService
  ) { }

  async createTrialSubscription(userId: string) {
    const existing = await this.subscriptions.findOne({ userId });
    if (existing) return existing;

    return this.subscriptions.create({
      userId,
      plan: 'trial',
      status: 'active',
      startAt: new Date(),
      endAt: new Date(Date.now() + parseInt(process.env.TRIAL_DAYS || '3', 10) * 24 * 60 * 60 * 1000), // Configurable trial days
      remainingTrials: parseInt(process.env.TRIAL_COUNT || '3', 10),
      autoRenew: false
    });
  }

  private async getTodayUsageCount(userId: string): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const records = await this.usageRecords.find({
      userId,
      createdAt: { $gte: startOfDay },
      type: { $in: ['recognize_ingredients', 'generate_recipe', 'ingredient_recognition', 'recipe_generation'] },
    }).select('type').lean();

    return records.reduce((acc, record) => {
      const cost = (record.type === 'recognize_ingredients' || record.type === 'ingredient_recognition') ? 2 : 1;
      return acc + cost;
    }, 0);
  }

  async getUserSubscription(userId: string) {
    const sub = await this.subscriptions.findOne({ userId }).lean()
    this.logger.log('getUserSubscription', sub)
    if (!sub) return null

    const now = new Date()

    if (sub.plan === 'trial') {
      const trialExpiredByTime = !!sub.endAt && new Date(sub.endAt) <= now
      const noTrialsLeft = (sub.remainingTrials || 0) <= 0

      if (trialExpiredByTime || noTrialsLeft) {
        await this.subscriptions.updateOne(
          { _id: sub._id },
          {
            $set: {
              plan: 'free',
              endAt: null,
              remainingTrials: 0
            }
          }
        )

        sub.plan = 'free'
        sub.endAt = undefined
        sub.remainingTrials = 0
      }
    }

    const DAILY_LIMIT = parseInt(process.env.DAILY_USAGE_LIMIT || '20', 10);
    const todayUsage = await this.getTodayUsageCount(userId);
    const dailyRemaining = Math.max(0, DAILY_LIMIT - todayUsage);

    return {
      plan: sub.plan,
      status: sub.status,
      startAt: sub.startAt,
      endAt: sub.endAt,
      remainingTrials: sub.remainingTrials || 0,
      appStoreSubscriptionId: sub.appStoreOriginalTransactionId,
      autoRenew: sub.autoRenew,
      dailyRemaining
    }
  }

  async hasActiveSubscription(userId: string): Promise<boolean> {
    const sub = await this.subscriptions.findOne({ userId }).lean()
    if (!sub) return false

    const now = new Date()

    const premiumPlans = [
      'com.mealnow.premium.monthly',
      'com.mealnow.premium.quarterly',
      'com.mealnow.premium.yearly'
    ]

    if (sub.status === 'active' && premiumPlans.includes(sub.plan)) {
      if (!sub.endAt || new Date(sub.endAt) > now) {
        return true
      }
    }

    if (
      sub.status === 'active' &&
      sub.plan === 'trial' &&
      (!sub.endAt || new Date(sub.endAt) > now) &&
      (sub.remainingTrials || 0) > 0
    ) {
      return true
    }

    return false
  }

  async findAllActiveSubscriberIds(): Promise<string[]> {
    const premiumPlans = [
      'monthly', 'quarterly', 'yearly',
      'com.mealnow.premium.monthly',
      'com.mealnow.premium.quarterly',
      'com.mealnow.premium.yearly'
    ];

    const now = new Date();

    const subs = await this.subscriptions.find({
      status: 'active',
      plan: { $in: premiumPlans },
      $or: [
        { endAt: { $exists: false } },
        { endAt: { $gt: now } }
      ]
    }).select('userId').lean()

    return subs.map(sub => sub.userId)
  }

  async findAllActiveTrialUserIds(): Promise<string[]> {
    const now = new Date()

    const trials = await this.subscriptions.find({
      status: 'active',
      plan: 'trial',
      $or: [
        { endAt: { $exists: false } },
        { endAt: { $gt: now } }
      ],
      remainingTrials: { $gt: 0 }
    }).select('userId').lean()

    return trials.map(sub => sub.userId)
  }

  async recordUsage(userId: string, type: string, amount: number, description?: string, relatedId?: string) {
    return this.usageRecords.create({
      userId,
      type,
      amount,
      description,
      relatedId
    })
  }

  async getUsageHistory(userId: string, limit: number = 20, offset: number = 0) {
    return this.usageRecords.find({ userId })
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .exec()
  }



  async getBillingConfig() {
    return {
      dailyUsageLimit: parseInt(process.env.DAILY_USAGE_LIMIT || '20', 10),
      trialUsageLimit: parseInt(process.env.TRIAL_COUNT || '3', 10)
    };
  }

  async checkAndConsumeQuota(userId: string, action: string = 'generic_usage', lang: string = 'en'): Promise<boolean> {
    let sub = await this.subscriptions.findOne({ userId })

    if (!sub) {
      // Fallback for missing subscription (e.g. legacy users or registration glitches)
      sub = await this.createTrialSubscription(userId);
    }

    const now = new Date()

    if (sub.plan === 'trial') {
      const trialExpiredByTime = !!sub.endAt && new Date(sub.endAt) <= now
      const noTrialsLeft = (sub.remainingTrials || 0) <= 0

      if (trialExpiredByTime || noTrialsLeft) {
        await this.subscriptions.updateOne(
          { _id: sub._id },
          {
            $set: {
              plan: 'free',
              endAt: null,
              remainingTrials: 0
            }
          }
        )

        sub.plan = 'free'
        sub.endAt = undefined
        sub.remainingTrials = 0
      }
    }

    // 1. Priority: Check Trials (Consume trials first)
    if (
      sub &&
      sub.plan === 'trial' &&
      sub.status === 'active' &&
      (!sub.endAt || new Date(sub.endAt) > now) &&
      (sub.remainingTrials || 0) > 0
    ) {
      const result = await this.subscriptions.updateOne(
        { userId, remainingTrials: { $gt: 0 } },
        { $inc: { remainingTrials: -1 } }
      );
      if (result.modifiedCount > 0) {
        await this.recordUsage(userId, action, -1, this.i18n.t('billing.quota.trial', { lang }));
        return true;
      }
    }

    // 2. Check Subscription (Paid Membership)
    const premiumPlans = [
      'com.mealnow.premium.monthly',
      'com.mealnow.premium.quarterly',
      'com.mealnow.premium.yearly'
    ];
    if (sub && sub.status === 'active' && premiumPlans.includes(sub.plan)) {
      const now = new Date()
      if (!sub.endAt || new Date(sub.endAt) > now) {
        // Daily Limit Check for Paid Users
        const DAILY_LIMIT = parseInt(process.env.DAILY_USAGE_LIMIT || '20', 10);
        
        const usageCount = await this.getTodayUsageCount(userId);

        if (usageCount >= DAILY_LIMIT) {
          const message = this.i18n.t('billing.quota.daily_limit_reached', { lang, args: { limit: DAILY_LIMIT } });
          throw new QuotaExceededError(message);
        }

        await this.recordUsage(userId, action, -1, this.i18n.t('billing.quota.member_benefit', { lang }))
        return true
      }
    }

    // 3. Handle Trial Expiration (Transition to Free)
    if (sub && sub.plan === 'trial' && (sub.remainingTrials || 0) <= 0) {
      await this.subscriptions.updateOne(
        { _id: sub._id },
        { 
          $set: { 
            plan: 'free', 
            endAt: null 
          } 
        }
      );
    }

    return false
  }

  async getUserStats(userId: string) {
    const [recipes, scans, lastUsage] = await Promise.all([
      this.usageRecords.countDocuments({
        userId,
        type: { $in: ['generate_recipe', 'recipe_generation'] }
      }),
      this.usageRecords.countDocuments({
        userId,
        type: { $in: ['recognize_ingredients', 'ingredient_recognition'] }
      }),
      this.usageRecords.findOne({ userId }).sort({ createdAt: -1 }).select('createdAt')
    ]);

    return {
      totalGenerations: recipes,
      totalRecognitions: scans,
      lastActiveAt: (lastUsage as any)?.createdAt || null
    };
  }

  async updateAppStoreSubscriptionStatus(originalTransactionId: string, status: string, expiresDate?: number, plan?: string) {
    const update: any = { status };
    if (expiresDate) {
      update.endAt = new Date(expiresDate);
    }
    if (plan) {
      update.plan = plan;
    }
    const result = await this.subscriptions.updateOne(
      { appStoreOriginalTransactionId: originalTransactionId },
      { $set: update }
    );

    if (result.matchedCount === 0) {
      console.warn(`[BillingService] Webhook received for unknown subscription: ${originalTransactionId}. Status: ${status}`);
    } else {
      console.log(`[BillingService] Updated subscription ${originalTransactionId} status to ${status}`);
    }
  }

  async updateAppStoreAutoRenewStatus(originalTransactionId: string, autoRenew: boolean) {
    console.log('updateAppStoreAutoRenewStatus', originalTransactionId, autoRenew)
    await this.subscriptions.updateOne(
      { appStoreOriginalTransactionId: originalTransactionId },
      { $set: { autoRenew } }
    );
  }

  async linkAppStoreSubscription(userId: string, originalTransactionId: string, plan: string, status: string, expiresDate: number, autoRenew: boolean, lang: string = 'en') {
    // 1. Transfer Strategy: Detach this subscription from any *other* user
    // This ensures one-to-one binding (OriginalTransactionId -> UserId)
    await this.subscriptions.updateMany(
      {
        appStoreOriginalTransactionId: originalTransactionId,
        userId: { $ne: userId } // Find other users
      },
      {
        $unset: {
          appStoreOriginalTransactionId: 1, // Remove the binding
        },
        $set: {
          status: 'expired', // Or just leave it cleanly detached
          plan: 'free',
          endAt: new Date(),
          autoRenew: false
        }
      }
    );

    // 2. Upsert for the current user
    await this.subscriptions.findOneAndUpdate(
      { userId },
      {
        $set: {
          userId,
          appStoreOriginalTransactionId: originalTransactionId,
          plan,
          status,
          endAt: new Date(expiresDate),
          autoRenew,
        },
        $setOnInsert: { startAt: new Date() }
      },
      { upsert: true, new: true }
    );

    // Record usage/history
    // await this.recordUsage(userId, 'subscription_start', 0, this.i18n.t('billing.subscription.app_store', { args: { plan }, lang }));
  }
}
