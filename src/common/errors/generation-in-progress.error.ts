import { GraphQLError } from 'graphql';

export class GenerationInProgressError extends GraphQLError {
  constructor(message: string = 'Generation in progress') {
    super(message, {
      extensions: {
        code: 'GENERATION_IN_PROGRESS',
      },
    });
  }
}
