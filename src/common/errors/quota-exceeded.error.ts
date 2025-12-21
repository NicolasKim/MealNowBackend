import { GraphQLError } from 'graphql';

export class QuotaExceededError extends GraphQLError {
  constructor(message: string = 'Quota exceeded') {
    super(message, {
      extensions: {
        code: 'QUOTA_EXCEEDED',
      },
    });
  }
}
