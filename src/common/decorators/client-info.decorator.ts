import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';

export interface ClientInfo {
  language: string;
  timezone: string;
}

export const CurrentClientInfo = createParamDecorator(
  (data: unknown, context: ExecutionContext): ClientInfo => {
    const ctx = GqlExecutionContext.create(context);
    const request = ctx.getContext().req;
    
    // Safety check for request object (e.g. if used in subscription or other contexts)
    if (!request) {
      return {
        language: 'en',
        timezone: 'UTC',
      };
    }

    const headers = request.headers || {};
    
    const languageHeader = headers['x-user-language'];
    const timezoneHeader = headers['x-user-timezone'];

    const language = Array.isArray(languageHeader) ? languageHeader[0] : languageHeader;
    const timezone = Array.isArray(timezoneHeader) ? timezoneHeader[0] : timezoneHeader;

    return {
      language: language || 'en',
      timezone: timezone || 'UTC',
    };
  },
);
