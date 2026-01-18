export class IngredientStandardizationError extends Error {
  constructor(message: string, public readonly stage: string, public readonly originalError?: any) {
    super(message);
    this.name = 'IngredientStandardizationError';
  }
}
