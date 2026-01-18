export interface FoodNutrient {
  nutrientId: number;
  nutrientName: string;
  nutrientNumber: string;
  unitName: string;
  value: number;
  indentLevel?: number;
}

export interface StandardizedIngredient {
  name: string;
  fdcId?: number | string;
  nutrients?: FoodNutrient[];
}
