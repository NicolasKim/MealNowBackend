import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { I18nService } from 'nestjs-i18n';
import { User, UserDocument } from '../auth/schemas/user.schema';
import { AiService } from '../ai/ai.service';
import { PantryService } from '../pantry/pantry.service';
import { RedisService } from '../redis/redis.service';

import { BillingService } from '../billing/billing.service';
import { NotificationService } from '../notification/notification.service';

import { Recipe } from './schemas/recipe.schema';

@Injectable()
export class RecipeSchedulerService {
  private readonly logger = new Logger(RecipeSchedulerService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Recipe.name) private recipeModel: Model<Recipe>,
    private readonly aiService: AiService,
    private readonly pantryService: PantryService,
    private readonly redisService: RedisService,
    private readonly billingService: BillingService,
    private readonly notificationService: NotificationService,
    private readonly i18n: I18nService,
  ) {}

  @Cron('0 0 * * * *') // Every hour
  async handleHourlySchedule() {
    this.logger.log('Running hourly recommendation schedule check...');

    const subscriberIds = await this.billingService.findAllActiveSubscriberIds();
    const trialUserIds = await this.billingService.findAllActiveTrialUserIds();

    const candidateIds = Array.from(new Set([...subscriberIds, ...trialUserIds]));
    
    const activeDaysThreshold = parseInt(process.env.DAILY_RECOMMENDATION_ACTIVE_DAYS || '5', 5);
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - activeDaysThreshold);

    const users = await this.userModel.find({ 
      _id: { $in: candidateIds },
      lastActiveAt: { $gte: fiveDaysAgo } // Only include users active in the last 5 days
    });

    if (users.length < candidateIds.length) {
      this.logger.log(`Skipped ${candidateIds.length - users.length} users due to inactivity (> 5 days).`);
    }

    // 2. Group users by required action (mealType)
    const usersByMealType: Record<string, UserDocument[]> = {
      breakfast: [],
      lunch: [],
      dinner: []
    };

    const now = new Date();

    for (const user of users) {
      const timezone = user.timezone || 'UTC';
      let localHour: number;
      try {
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          hour: 'numeric',
          hour12: false
        });
        localHour = parseInt(formatter.format(now));
      } catch (e) {
        this.logger.warn(`Invalid timezone '${timezone}' for user ${user._id}, defaulting to UTC`);
        localHour = now.getUTCHours();
      }

      if (localHour === 6) usersByMealType.breakfast.push(user);
      else if (localHour === 11) usersByMealType.lunch.push(user);
      else if (localHour === 17) usersByMealType.dinner.push(user);
    }

    // 3. Process each group
    for (const [mealType, targetUsers] of Object.entries(usersByMealType)) {
      if (targetUsers.length === 0) continue;

      this.logger.log(`Generating ${mealType} recommendations for ${targetUsers.length} users...`);

      // Ensure public recommendations exist for all supported languages
      const supportedLanguages = ['en', 'zh'];
      for (const lang of supportedLanguages) {
        await this.generatePublicRecommendations(mealType, lang);
      }

      // Generate for each user
      for (const user of targetUsers) {
        await this.generateForUser(user, mealType, true);
      }
    }
  }

  private async generateRecommendations(mealType: string) {
    // Deprecated: Logic moved to handleHourlySchedule to support timezones
    // Kept for manual trigger reference if needed, or can be removed.
    // Re-implementing as a simple wrapper for manual testing if needed
    // but for now, I'll remove the cron usage of it.
  }

  async generatePublicRecommendations(mealType: string, lang: string = 'en') {
    const style = this.i18n.t(`recipe.meal_styles.${mealType}`, { lang, defaultValue: this.i18n.t(`recipe.meal_styles.dinner`, { lang }) });
    const today = new Date().toISOString().split('T')[0];
    const key = `recommendation:public:${lang}:${today}:${mealType}`;
    
    // Check cache
    const cached = await this.redisService.get().get(key);
    if (cached) return JSON.parse(cached);

    try {
        this.logger.log(`Generating public ${mealType} recommendations for lang ${lang}...`);
        const recommendations = await this.aiService.generateDailyRecommendations({
            mealType,
            style,
            expiringIngredients: [],
            freshIngredients: [],
            preference: [] 
        }, lang);
        
        if (recommendations && recommendations.length > 0) {
            const content = JSON.stringify(recommendations);
            await this.redisService.get().setex(key, 86400, content);
            return recommendations;
        }
        return [];
    } catch (error) {
        this.logger.error(`Error generating public recommendations`, error);
        return [];
    }
  }

  async generateForUser(user: UserDocument, mealType: string, isScheduled: boolean = false, langOverride?: string) {
    const userId = user._id.toString();
    const isSubscribed = await this.billingService.hasActiveSubscription(userId);
    const lang = langOverride || user.language || 'en';

    // For non-subscribed users, return public recommendations
    if (!isSubscribed) {
        return this.generatePublicRecommendations(mealType, lang);
    }

    const style = this.i18n.t(`recipe.meal_styles.${mealType}`, { lang, defaultValue: this.i18n.t(`recipe.meal_styles.dinner`, { lang }) });
    
    try {
        // Check DB first for today's recommendations
        const startOfDay = new Date();
        startOfDay.setUTCHours(0,0,0,0);
        const endOfDay = new Date();
        endOfDay.setUTCHours(23,59,59,999);

        const existing = await this.recipeModel.find({
            userId: user._id,
            mealType: mealType,
            createdAt: { $gte: startOfDay, $lte: endOfDay }
        });

        if (existing && existing.length > 0) {
             return existing.map(r => ({ ...r.toObject(), id: r._id.toString() }));
        }

        const pantryItems = await this.pantryService.findAll(userId);
        
        const now = new Date();
        const sevenDaysFromNow = new Date();
        sevenDaysFromNow.setDate(now.getDate() + 7);

        const expiringIngredients: { name: string; quantity: number; unit: string }[] = [];
        const freshIngredients: { name: string; quantity: number; unit: string }[] = [];

        for (const item of pantryItems) {
            const ingredient = {
                name: item.name,
                quantity: item.quantity,
                unit: item.unit
            };

            if (item.expiryDate) {
                const expiry = new Date(item.expiryDate);
                if (expiry <= sevenDaysFromNow) {
                    expiringIngredients.push(ingredient);
                    continue;
                }
            }
            freshIngredients.push(ingredient);
        }

        const recommendations = await this.aiService.generateDailyRecommendations({
            mealType,
            style,
            expiringIngredients,
            freshIngredients,
            preference: user.tastePreferences
        }, lang);
        
        if (recommendations && recommendations.length > 0) {
            const savedRecipes = [];
            for (const recipe of recommendations) {
                 const saved = await this.recipeModel.create({
                     ...recipe,
                     _id: recipe.id,
                     userId: user._id,
                     mealType: mealType
                 });
                 savedRecipes.push({ ...saved.toObject(), id: saved._id.toString() });
            }

            this.logger.log(`Generated ${mealType} recommendations for user ${userId}`);

            if (isScheduled && user.deviceTokens && user.deviceTokens.length > 0) {
                const title = this.i18n.t('notification.daily_recommendation.title', { lang });
                const translatedMealType = this.i18n.t(`recipe.meal_types.${mealType}`, { lang, defaultValue: mealType });
                const body = this.i18n.t('notification.daily_recommendation.body', { lang, args: { mealType: translatedMealType } });
                await this.notificationService.sendNotification(user.deviceTokens, title, body, {
                    type: 'daily_recommendation',
                    mealType,
                    recommendationCount: recommendations.length
                });
            }

            return savedRecipes;
        }
        
        return [];

    } catch (error) {
        this.logger.error(`Error generating recommendations for user ${user._id}`, error);
        return [];
    }
  }
}
