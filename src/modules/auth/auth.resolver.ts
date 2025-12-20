import { Args, Mutation, Query, Resolver, Context } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { UserDocument } from './schemas/user.schema';
import { I18nService } from 'nestjs-i18n';
import { CurrentClientInfo, ClientInfo } from '../../common/decorators/client-info.decorator';

export class UpdateProfileInput {
    nickname?: string;
    gender?: string;
    region?: string;
    avatar?: string;
    language?: string;
}

@Resolver('Auth')
export class AuthResolver {
    constructor(
        private readonly authService: AuthService,
        private readonly i18n: I18nService,
    ) { }

    @Query('hello')
    async hello(@CurrentClientInfo() clientInfo: ClientInfo) {
        return this.i18n.t('common.welcome', {
            lang: clientInfo.language,
            args: { name: 'User' },
        });
    }

    @Query('me')
    @UseGuards(JwtAuthGuard)
    async me(@CurrentUser() user: UserDocument) {
        return user;
    }

    @Mutation('loginWithPassword')
    async loginWithPassword(
        @Args('email') email: string,
        @Args('password') password: string,
        @CurrentClientInfo() clientInfo: ClientInfo,
    ) {
        return this.authService.loginWithPassword(email, password, clientInfo.language);
    }

    @Mutation('registerWithEmail')
    async registerWithEmail(
        @Args('email') email: string,
        @Args('password') password: string,
        @Args('code') code: string,
        @CurrentClientInfo() clientInfo: ClientInfo,
    ) {
        return this.authService.registerWithEmail(email, password, code, clientInfo.language);
    }

    @Mutation('loginWithThirdParty')
    async loginWithThirdParty(
        @Args('platform') platform: string,
        @Args('token') token: string,
        @CurrentClientInfo() clientInfo: ClientInfo,
        @Args('nickname') nickname?: string,
    ) {
        return this.authService.loginWithThirdParty(platform, token, nickname, clientInfo.language);
    }

    @Mutation('sendVerificationCode')
    async sendVerificationCode(
        @Args('email') email: string,
        @CurrentClientInfo() clientInfo: ClientInfo,
    ) {
        return this.authService.sendVerificationCode(email, clientInfo.language);
    }

    @Mutation('resetPassword')
    async resetPassword(
        @Args('email') email: string,
        @Args('password') password: string,
        @Args('code') code: string,
        @CurrentClientInfo() clientInfo: ClientInfo,
    ) {
        return this.authService.resetPassword(email, password, code, clientInfo.language);
    }

    @Mutation('logout')
    @UseGuards(JwtAuthGuard)
    async logout(@Context() context: any) {
        const token = context.req.headers.authorization?.replace('Bearer ', '');
        if (token) {
            return this.authService.logout(token);
        }
        return false;
    }

    @Mutation('updateProfile')
    @UseGuards(JwtAuthGuard)
    async updateProfile(
        @CurrentUser() user: UserDocument,
        @Args('input') input: UpdateProfileInput,
        @CurrentClientInfo() clientInfo: ClientInfo,
    ) {
        return this.authService.updateProfile(user._id.toString(), input, clientInfo.language);
    }

    @Mutation('registerDeviceToken')
    @UseGuards(JwtAuthGuard)
    async registerDeviceToken(
        @CurrentUser() user: UserDocument,
        @Args('token') token: string,
    ) {
        return this.authService.registerDeviceToken(user._id.toString(), token);
    }

    @Mutation('deactivateAccount')
    @UseGuards(JwtAuthGuard)
    async deactivateAccount(@CurrentUser() user: UserDocument) {
        return this.authService.deactivateAccount(user._id.toString());
    }
}
