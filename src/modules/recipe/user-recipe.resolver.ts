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
    
    // Extract IDs from new object structure or legacy strings
    const savedList = user.savedRecipes;
    const recipeIds = savedList.map((item: any) => typeof item === 'string' ? item : item.recipeId);

    const recipes = await this.recipeModel.find({ _id: { $in: recipeIds } });
    
    // Create a map for quick lookup
    const recipeMap = new Map(recipes.map(r => [r._id.toString(), r]));
    
    // Sort by addedAt desc (latest first)
    const sortedList = [...savedList].sort((a: any, b: any) => {
        // Handle legacy strings (treat as old) vs objects with dates
        if (typeof a === 'string' && typeof b === 'string') return 0; // Maintain existing order if both strings
        if (typeof a === 'string') return 1; // String is older than object
        if (typeof b === 'string') return -1; // Object is newer than string
        
        const timeA = a.addedAt ? new Date(a.addedAt).getTime() : 0;
        const timeB = b.addedAt ? new Date(b.addedAt).getTime() : 0;
        return timeB - timeA;
    });

    // If all are strings (legacy), we might want to just reverse the original list to maintain LIFO behavior
    // But since we are sorting above, let's just use the sorted list which handles objects correctly.
    // For mixed or all-string arrays without dates, the sort might be stable or not ideal, 
    // so let's enforce LIFO for legacy strings if needed. 
    // However, the new requirement is "Sort by addedAt".
    // For backward compatibility: if no addedAt, maybe use index? 
    // Let's stick to the sort logic above which prioritizes newer objects.
    
    // Actually, to be safe for legacy (LIFO) and new (Time Sort), let's refine:
    // If it's a legacy string, we don't have time. 
    // If it's a new object, we have time.
    
    const orderedRecipes = [];
    for (const item of sortedList) {
        const id = typeof item === 'string' ? item : item.recipeId;
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
