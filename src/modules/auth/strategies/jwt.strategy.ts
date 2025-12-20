import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../schemas/user.schema';
import { AuthService } from '../auth.service';
import { Request } from 'express';
import { I18nService } from 'nestjs-i18n';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private authService: AuthService,
    private readonly i18n: I18nService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'fallback_secret_key_for_dev',
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: any) {
    const token = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
    if (token && await this.authService.isTokenBlacklisted(token)) {
      throw new UnauthorizedException('Token is invalidated');
    }

    // payload.sub is the userId
    const user = await this.userModel.findById(payload.sub).exec();
    
    if (!user) {
      throw new UnauthorizedException();
    }

    if (user.status === 'frozen') {
      const message = this.i18n.translate('auth.error.accountFrozen', {
        lang: user.language || 'en',
      });
      throw new UnauthorizedException(message);
    }

    // Check token version for single device login
    const tokenVersion = payload.tokenVersion || 0;
    const userVersion = user.tokenVersion || 0;

    if (tokenVersion !== userVersion) {
      const message = this.i18n.translate('auth.error.sessionExpired', {
        lang: user.language || 'en',
      });
      throw new UnauthorizedException(message);
    }

    return user;
  }
}
