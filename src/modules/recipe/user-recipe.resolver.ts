import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Recipe } from './schemas/recipe.schema';
import { UserDocument } from '../auth/schemas/user.schema';

@Resolver('User')
export class UserRecipeResolver {
  constructor(@InjectModel(Recipe.name) private recipeModel: Model<Recipe>) {}

  @ResolveField('savedRecipes')
  async getSavedRecipes(@Parent() user: UserDocument) {
    if (!user.savedRecipes || user.savedRecipes.length === 0) return [];
    
    const recipes = await this.recipeModel.find({ _id: { $in: user.savedRecipes } });
    
    // Create a map for quick lookup
    const recipeMap = new Map(recipes.map(r => [r._id.toString(), r]));
    
    // Reverse the savedRecipes IDs to get latest first (LIFO)
    const reversedIds = [...user.savedRecipes].reverse();
    
    const orderedRecipes = [];
    for (const id of reversedIds) {
        const recipe = recipeMap.get(id.toString());
        if (recipe) {
            orderedRecipes.push(recipe);
        }
    }

    // Map _id to id
    return orderedRecipes.map(r => {
      const obj = r.toObject();
      return {
        ...obj,
        id: r._id.toString(),
        steps: obj.steps || [],
        ingredients: obj.ingredients || []
      };
    });
  }

  @ResolveField('savedRecipesCount')
  async getSavedRecipesCount(@Parent() user: UserDocument) {
    return user.savedRecipes?.length || 0;
  }
}
