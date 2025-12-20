import { CallHandler, ExecutionContext, Injectable, NestInterceptor, Logger } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Observable } from 'rxjs';
import { User, UserDocument } from '../../modules/auth/schemas/user.schema';

@Injectable()
export class TimezoneInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TimezoneInterceptor.name);

  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = GqlExecutionContext.create(context);
    const request = ctx.getContext().req;

    // Only proceed if we have a request and a user (authenticated)
    if (request && request.user) {
      const headers = request.headers || {};
      const timezoneHeader = headers['x-user-timezone'];
      const timezone = Array.isArray(timezoneHeader) ? timezoneHeader[0] : timezoneHeader;

      // Validate timezone string validity simply
      if (timezone && typeof timezone === 'string' && timezone.length > 0 && timezone !== 'null' && timezone !== 'undefined') {
        const user = request.user as UserDocument;
        
        // Check if update is needed to avoid DB write on every request
        // Also check if timezone is valid IANA string? optional but good.
        // For now, assuming client sends valid timezone string.
        let needsUpdate = false;
        const updates: Partial<UserDocument> = {};

        // Update timezone if changed
        if (user.timezone !== timezone) {
          this.logger.log(`Updating timezone for user ${user._id} from ${user.timezone || 'undefined'} to ${timezone}`);
          updates.timezone = timezone;
          user.timezone = timezone;
          needsUpdate = true;
        }

        // Update lastActiveAt if it's been more than 1 hour or doesn't exist
        const now = new Date();
        const lastActive = user.lastActiveAt ? new Date(user.lastActiveAt) : new Date(0);
        const oneHour = 60 * 60 * 1000;
        
        if (now.getTime() - lastActive.getTime() > oneHour) {
             updates.lastActiveAt = now;
             user.lastActiveAt = now;
             needsUpdate = true;
        }

        if (needsUpdate) {
          // Update in DB
          // We don't await this to keep response time low, but we catch errors.
          // Using updateOne is more efficient than findByIdAndUpdate if we don't need the result.
          this.userModel.updateOne({ _id: user._id }, updates).exec().catch(err => {
            this.logger.error(`Failed to update user info for user ${user._id}`, err);
          });
        }
      }
    }

    return next.handle();
  }
}
