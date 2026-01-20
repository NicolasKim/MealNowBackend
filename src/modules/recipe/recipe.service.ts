import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Recipe, RecipeDocument } from './schemas/recipe.schema';
import { AiService } from '../ai/ai.service';

@Injectable()
export class RecipeService {
  private readonly logger = new Logger(RecipeService.name);

  constructor(
    @InjectModel(Recipe.name) private readonly recipeModel: Model<RecipeDocument>,
    private readonly aiService: AiService,
  ) {}

  async getRecipeById(id: string): Promise<Recipe> {
    const recipe = await this.recipeModel.findById(id).exec();
    if (!recipe) {
      throw new NotFoundException(`Recipe with ID ${id} not found`);
    }

    let hasChanges = false;
    const ingredients = recipe.ingredients || [];

    // Check if any ingredient is missing preciseAmount/preciseUnit
    // If so, convert using AI and save back to DB
    const updatePromises = ingredients.map(async (ingredient: any) => {
      // If unit is already 'g', set precise values directly if missing
      if (ingredient.unit === 'g' && (!ingredient.preciseAmount || !ingredient.preciseUnit)) {
          ingredient.preciseAmount = ingredient.amount;
          ingredient.preciseUnit = 'g';
          hasChanges = true;
          return;
      }

      // If missing precise info and unit is not 'g', use AI to convert
      if ((!ingredient.preciseAmount || !ingredient.preciseUnit) && ingredient.unit && ingredient.amount) {
        try {
          const grams = await this.aiService.convertUnitToGrams(
            ingredient.name,
            ingredient.amount,
            ingredient.unit
          );
          
          ingredient.preciseAmount = grams;
          ingredient.preciseUnit = 'g';
          hasChanges = true;
          this.logger.log(`Converted ${ingredient.amount} ${ingredient.unit} of ${ingredient.name} to ${grams}g`);
        } catch (e) {
          this.logger.error(`Failed to convert unit for recipe ${id}, ingredient ${ingredient.name}`, e);
        }
      }
    });

    if (ingredients.length > 0) {
        await Promise.all(updatePromises);
    }

    if (hasChanges) {
      // Save changes to database
      await this.recipeModel.findByIdAndUpdate(id, {
        ingredients: ingredients
      });
      this.logger.log(`Updated recipe ${id} with precise ingredient amounts`);
    }

    return recipe;
  }
}
