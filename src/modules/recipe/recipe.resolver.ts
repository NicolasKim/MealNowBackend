import { Args, Mutation, Query, Resolver } from '@nestjs/graphql'
import { UseGuards, NotFoundException, ForbiddenException, Logger, Inject } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { RedisPubSub } from 'graphql-redis-subscriptions'
import { AiService } from '../ai/ai.service'
import { PantryService } from '../pantry/pantry.service'
import { BillingService } from '../billing/billing.service'
import { NotificationService } from '../notification/notification.service'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { CurrentClientInfo, ClientInfo } from '../../common/decorators/client-info.decorator'
import { QuotaExceededError } from '../../common/errors/quota-exceeded.error'
import { UserDocument } from '../auth/schemas/user.schema'
import { RedisService } from '../redis/redis.service'
import { RecipeSchedulerService } from './recipe.scheduler'
import { Recipe } from './schemas/recipe.schema'

import { JwtAuthGuardOptional } from '../auth/guards/jwt-auth-optional.guard'

import { I18nService } from 'nestjs-i18n'

import { GenerationInProgressError } from '../../common/errors/generation-in-progress.error';

@Resolver()
export class RecipeResolver {
  private readonly logger = new Logger(RecipeResolver.name);

  constructor(
    private readonly ai: AiService,
    private readonly pantryService: PantryService,
    private readonly billing: BillingService,
    private readonly redisService: RedisService,
    private readonly recipeScheduler: RecipeSchedulerService,
    private readonly notificationService: NotificationService,
    @InjectModel(Recipe.name) private recipeModel: Model<Recipe>,
    @InjectModel('User') private userModel: Model<UserDocument>,
    @Inject('PUB_SUB') private readonly pubSub: RedisPubSub,
    private readonly i18n: I18nService,
  ) {}

  private async handleAsyncRecipeGeneration(
    taskId: string,
    user: UserDocument,
    generationFn: () => Promise<any[]>,
    lang: string
  ) {
    this.logger.log(`Starting async generation for task ${taskId} user ${user._id}`);
    try {
      const recipes = await generationFn();
      
      if (!recipes || recipes.length === 0) {
        throw new Error(this.i18n.t('recipe.errors.generation_failed', { lang }));
      }

      // Store recipes in MongoDB
      const savedRecipes = [];
      for (const recipe of recipes) {
        const saved = await this.recipeModel.findByIdAndUpdate(
          recipe.id,
          {
            ...recipe,
            _id: recipe.id,
            userId: user._id,
          },
          { new: true, upsert: true }
        );
        
        if (saved) {
            savedRecipes.push({
            ...saved.toObject(),
            id: saved._id.toString()
            });
        }
      }

      this.logger.log(`Task ${taskId} completed. Publishing to user ${user._id}`);

      // Update task in Redis
      await this.redisService.updateTask(taskId, 'SUCCESS', savedRecipes);

      // Publish notification
      await this.pubSub.publish('taskCompleted', {
        taskCompleted: {
          userId: user._id.toString(),
          taskId: taskId,
          type: 'recipe_generation',
          status: 'success',
          data: savedRecipes,
          metadata: (await this.redisService.get().get(`task:${taskId}`).then(t => t ? JSON.parse(t).metadata : null))
        }
      });

      // Send APNs notification
      if (user.deviceTokens && user.deviceTokens.length > 0) {
        const title = this.i18n.t('notification.recipe_ready.title', { lang });
        const body = this.i18n.t('notification.recipe_ready.body', { lang });
        await this.notificationService.sendNotification(user.deviceTokens, title, body, { taskId, type: 'recipe_generation' });
      }

    } catch (error) {
      this.logger.error(`Task ${taskId} failed`, error);
      
      // Update task in Redis
      await this.redisService.updateTask(taskId, 'ERROR', null, (error as any).message);

      await this.pubSub.publish('taskCompleted', {
        taskCompleted: {
          userId: user._id.toString(),
          taskId: taskId,
          type: 'recipe_generation',
          status: 'error',
          data: { message: (error as any).message }
        }
      });
    }
  }

  @Query('myTasks')
  @UseGuards(JwtAuthGuard)
  async myTasks(@CurrentUser() user: UserDocument) {
    return this.redisService.getUserTasks(user._id.toString());
  }

  @Query('dailyRecommendations')
  @UseGuards(JwtAuthGuardOptional)
  async dailyRecommendations(
    @CurrentUser() user: UserDocument | null,
    @Args('mealType') mealType: string,
    @CurrentClientInfo() clientInfo: ClientInfo
  ) {
    const lang = clientInfo.language;

    if (!user) {
      return this.recipeScheduler.generatePublicRecommendations(mealType, lang);
    }

    // Lock logic has been moved to recipeScheduler.generateForUser
    // to protect both API calls and scheduled tasks
    return this.recipeScheduler.generateForUser(user, mealType, false, lang)
  }

  @Query('recommendations')
  @UseGuards(JwtAuthGuard)
  async recommendations(
    @Args('count') count: number,
    @CurrentUser() user: UserDocument,
    @CurrentClientInfo() clientInfo: ClientInfo
  ) {
    const recipes = await this.ai.generateRecipes({ ingredientNames: [], count, preference: undefined }, clientInfo.language)
    
    // Store recipes in MongoDB
    const savedRecipes = [];
    for (const recipe of recipes) {
      const saved = await this.recipeModel.findByIdAndUpdate(
        recipe.id,
        {
          ...recipe,
          _id: recipe.id,
          userId: user._id,
        },
        { new: true, upsert: true }
      );
      savedRecipes.push({
        ...saved.toObject(),
        id: saved._id.toString()
      });
    }

    return savedRecipes;
  }

  @Mutation('generateRecipes')
  @UseGuards(JwtAuthGuard)
  async generateRecipes(
    @Args('input') input: { ingredientNames: string[]; preference?: any },
    @Args('count') count: number,
    @CurrentUser() user: UserDocument,
    @CurrentClientInfo() clientInfo: ClientInfo
  ) {
    const lang = clientInfo.language;
    const hasQuota = await this.billing.checkAndConsumeQuota(String(user._id), 'generate_recipe', lang)
    if (!hasQuota) {
      const message = this.i18n.t('recipe.errors.quota_exceeded', { lang });
      throw new QuotaExceededError(message);
    }

    const taskId = new Types.ObjectId().toString();
    
    // Create task in Redis
    await this.redisService.createTask(
      user._id.toString(), 
      taskId, 
      'recipe_generation', 
      'Recipe Generation',
      { source: 'scan', ingredientNames: input.ingredientNames }
    );

    const generationFn = () => this.ai.generateRecipes({ ingredientNames: input.ingredientNames, preference: input.preference, count }, clientInfo.language);

    // Fire and forget
    this.handleAsyncRecipeGeneration(taskId, user, generationFn, lang);

    return { taskId, message: 'Recipe generation started' };
  }

  @Mutation('generateSurpriseRecipes')
  @UseGuards(JwtAuthGuard)
  async generateSurpriseRecipes(
    @Args('count') count: number,
    @Args('mealType', { nullable: true }) mealType: string,
    @Args('excludedDishes', { nullable: true }) excludedDishes: string[],
    @CurrentUser() user: UserDocument,
    @CurrentClientInfo() clientInfo: ClientInfo
  ) {
    const lang = clientInfo.language;
    const lockKey = `lock:surprise_recipe:${user._id}`;
    const redis = this.redisService.get();

    // Try to acquire lock
    const acquired = await redis.set(lockKey, '1', 'EX', 300, 'NX');
    if (!acquired) {
         throw new GenerationInProgressError(this.i18n.t('recipe.errors.generation_in_progress', { lang, defaultValue: 'Generation in progress, please wait...' }));
    }

    try {
        const hasQuota = await this.billing.checkAndConsumeQuota(String(user._id), 'generate_recipe', lang)
        if (!hasQuota) {
          const message = this.i18n.t('recipe.errors.quota_exceeded', { lang });
          throw new QuotaExceededError(message);
        }

        // 1. Get Pantry Items
        const items = await this.pantryService.findFresh(user._id.toString());
        
        // 2. Categorize Ingredients
        const now = new Date();
        const expiring: { name: string; quantity: number; unit: string }[] = [];
        const fresh: { name: string; quantity: number; unit: string }[] = [];

        items.forEach(item => {
          const ingredient = {
            name: item.name,
            quantity: item.quantity,
            unit: item.unit
          };

          if (item.expiryDate) {
            const expiry = new Date(item.expiryDate);
            const diffTime = expiry.getTime() - now.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
            
            if (diffDays <= 5) {
              expiring.push(ingredient);
            } else {
              fresh.push(ingredient);
            }
          } else {
            fresh.push(ingredient);
          }
        });

        // 3. Get User Preferences
        const preference = {
          tags: user.tastePreferences,
        };

        // 4. Get recent recipes (last 7 days) to exclude
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        
        const recentRecipes = await this.recipeModel.find({
            userId: user._id,
            createdAt: { $gte: sevenDaysAgo }
        }).select('title').exec();
        
        const recentTitles = recentRecipes.map(r => r.title);
        const allExcludedDishes = [...(excludedDishes || []), ...recentTitles];
        // Deduplicate
        const uniqueExcludedDishes = Array.from(new Set(allExcludedDishes));

        const taskId = new Types.ObjectId().toString();
        
        // Create task in Redis
        await this.redisService.createTask(user._id.toString(), taskId, 'recipe_generation', 'AI Surprise Recommendation');

        const generationFn = async () => {
            try {
                return await this.ai.generateSurpriseRecipes({
                    expiringIngredients: expiring,
                    freshIngredients: fresh,
                    preference,
                    count,
                    mealType,
                    excludedDishes: uniqueExcludedDishes
                }, clientInfo.language);
            } catch (e) {
                this.logger.error('AI Service call failed', e);
                throw new Error(this.i18n.t('recipe.errors.ai_service_unavailable', { lang }));
            } finally {
                await redis.del(lockKey);
            }
        };

        // Fire and forget
        this.handleAsyncRecipeGeneration(taskId, user, generationFn, lang);

        return { taskId, message: 'Surprise recipe generation started' };
    } catch (error) {
        await redis.del(lockKey);
        throw error;
    }
  }

  @Mutation('completeTask')
  @UseGuards(JwtAuthGuard)
  async completeTask(
    @Args('taskId') taskId: string,
    @CurrentUser() user: UserDocument
  ) {
    await this.redisService.deleteTask(user._id.toString(), taskId);
    return true;
  }

  @Mutation('addToFavorites')
  @UseGuards(JwtAuthGuard)
  async addToFavorites(
    @Args('id') id: string,
    @CurrentUser() user: UserDocument,
    @CurrentClientInfo() clientInfo: ClientInfo
  ) {
    const lang = clientInfo.language;
    
    // 1. Check if recipe exists in DB
    let recipe = await this.recipeModel.findById(id);

    // 2. If not in DB, check Redis (Legacy/Migration support)
    if (!recipe) {
        // Search in public recommendations
        const today = new Date().toISOString().split('T')[0];
        const mealTypes = ['breakfast', 'lunch', 'dinner'];
        let recipeData = null;

        for (const mealType of mealTypes) {
            const key = `recommendation:public:${lang}:${today}:${mealType}`;
            const cached = await this.redisService.get().get(key);
            
            if (cached) {
                const recipes = JSON.parse(cached);
                if (Array.isArray(recipes)) {
                    const found = recipes.find((r: any) => r.id === id || r._id === id);
                    if (found) {
                        recipeData = found;
                        break;
                    }
                }
            }
        }
        
        if (!recipeData) {
            // Fallback to legacy key check
            const key = `recipe:${user._id.toString()}:${id}`;
            const cached = await this.redisService.get().get(key);
            if (cached) {
                recipeData = JSON.parse(cached);
            }
        }

        if (!recipeData) {
            throw new NotFoundException(this.i18n.t('recipe.errors.recipe_not_found', { lang }));
        }
        
        // Save to MongoDB
        recipe = await this.recipeModel.findByIdAndUpdate(
            id,
            {
                ...recipeData,
                _id: id,
                userId: user._id,
            },
            { new: true, upsert: true }
        );
    }
    
    if (!recipe) {
        throw new NotFoundException(this.i18n.t('recipe.errors.recipe_not_found', { lang }));
    }

    // 3. Update User's savedRecipes list
    await this.userModel.findByIdAndUpdate(user._id, {
      $addToSet: { savedRecipes: recipe._id }
    });
    
    return {
      ...recipe.toObject(),
      id: recipe._id.toString()
    };
  }

  @Mutation('removeFromFavorites')
  @UseGuards(JwtAuthGuard)
  async removeFromFavorites(
    @Args('id') id: string,
    @CurrentUser() user: UserDocument
  ) {
    const result = await this.userModel.findByIdAndUpdate(
      user._id,
      { $pull: { savedRecipes: id } },
      { new: true }
    );
    return !!result;
  }

  @Query('myRecipes')
  @UseGuards(JwtAuthGuard)
  async myRecipes(
    @Args('limit') limit: number = 20,
    @Args('offset') offset: number = 0,
    @CurrentUser() user: UserDocument
  ) {
    const recipes = await this.recipeModel.find({ userId: user._id })
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit);
    
    return recipes.map(r => ({
      ...r.toObject(),
      id: r._id.toString(),
      // Ensure createdAt is available
      createdAt: (r as any).createdAt
    }));
  }

  @Query('missingIngredients')
  @UseGuards(JwtAuthGuard)
  async missingIngredients(
    @Args('recipeId') recipeId: string,
    @CurrentUser() user: UserDocument,
    @CurrentClientInfo() clientInfo: ClientInfo
  ) {
    const lang = clientInfo.language;

    // 1. Get Recipe
    const recipe = await this.recipeModel.findById(recipeId);
    if (!recipe) {
      throw new NotFoundException(this.i18n.t('recipe.errors.recipe_not_found', { lang }));
    }

    // 2. Get Fresh Pantry Items
    const pantryItems = await this.pantryService.findFresh(user._id.toString());

    // 3. Prepare data for AI
    const recipeIngredients = recipe.ingredients?.map(i => ({
      name: i.name,
      amount: i.amount || i.quantity || 0,
      unit: i.unit || ''
    })) || [];

    const pantryInventory = pantryItems.map(i => ({
      name: i.name,
      quantity: i.quantity,
      unit: i.unit
    }));

    // 4. Calculate Missing
    return this.ai.calculateMissingIngredients(recipeIngredients, pantryInventory, lang);
  }

  @Mutation('deleteRecipe')
  @UseGuards(JwtAuthGuard)
  async deleteRecipe(
    @Args('id') id: string,
    @CurrentUser() user: UserDocument
  ) {
    const result = await this.recipeModel.deleteOne({ _id: id, userId: user._id });
    return result.deletedCount > 0;
  }
}
