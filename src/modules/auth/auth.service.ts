import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import { User, UserDocument } from './schemas/user.schema';
import * as bcrypt from 'bcryptjs';
import { RedisService } from '../redis/redis.service';
import { EmailService } from '../email/email.service';
import appleSignin from 'apple-signin-auth';
import { I18nService } from 'nestjs-i18n';
import { BillingService } from '../billing/billing.service';

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);

    constructor(
        @InjectModel(User.name) private userModel: Model<UserDocument>,
        private jwtService: JwtService,
        private readonly redisService: RedisService,
        private readonly emailService: EmailService,
        private readonly i18n: I18nService,
        private readonly billingService: BillingService,
    ) { }

    async sendVerificationCode(email: string, lang: string = 'en'): Promise<boolean> {
        // Generate a 4-digit random code
        const code = Math.floor(1000 + Math.random() * 9000).toString();
        
        // Store in Redis with 5 minutes expiration
        // Key format: verification_code:{email}
        const key = `verification_code:${email}`;
        await this.redisService.get().setex(key, 300, code);

        // Send email
        return this.emailService.sendVerificationEmail(email, code, lang);
    }

    async loginWithPassword(email: string, password: string, lang: string = 'en'): Promise<{ token: string, user: UserDocument }> {
        // Find user with password field included
        const user = await this.userModel.findOne({ email }).select('+password').exec();

        if (!user) {
            throw new UnauthorizedException(this.i18n.t('auth.error.invalidEmailOrPassword', { lang }));
        }

        if (user.status === 'frozen') {
            throw new UnauthorizedException(this.i18n.t('auth.error.accountFrozen', { lang }));
        }

        // Check if user has a password set
        if (!user.password) {
            throw new UnauthorizedException(this.i18n.t('auth.error.passwordNotSet', { lang }));
        }

        // Verify password
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            throw new UnauthorizedException(this.i18n.t('auth.error.invalidEmailOrPassword', { lang }));
        }

        // Update language preference only if not set
        if (!user.language) {
            user.language = lang;
        }

        // Increment token version to invalidate old tokens (kick other devices)
        user.tokenVersion = (user.tokenVersion || 0) + 1;
        await user.save();

        const token = this.generateToken(user);
        return { token, user };
    }

    async registerWithEmail(email: string, password: string, code: string, lang: string = 'en'): Promise<{ token: string, user: UserDocument }> {
        // Verify code
        const key = `verification_code:${email}`;
        const storedCode = await this.redisService.get().get(key);
        
        if (!storedCode || storedCode !== code) {
            throw new UnauthorizedException(this.i18n.t('auth.error.invalidVerificationCode', { lang }));
        }

        // Clear code after successful use
        await this.redisService.get().del(key);

        // Check if user already exists
        const existingUser = await this.userModel.findOne({ email });
        if (existingUser) {
            throw new Error(this.i18n.t('auth.error.userExists', { lang }));
        }

        // Validate password strength (at least 6 characters)
        if (password.length < 6) {
            throw new Error(this.i18n.t('auth.error.passwordTooShort', { lang }));
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create new user
        const user = new this.userModel({
            email,
            password: hashedPassword,
            authProvider: 'email',
            language: lang,
        });
        await user.save();

        // Create trial subscription
        await this.billingService.createTrialSubscription(user.id);

        const token = this.generateToken(user);
        return { token, user };
    }

    async resetPassword(email: string, password: string, code: string, lang: string = 'en'): Promise<boolean> {
        // Verify code
        const key = `verification_code:${email}`;
        const storedCode = await this.redisService.get().get(key);

        if (!storedCode || storedCode !== code) {
            throw new UnauthorizedException(this.i18n.t('auth.error.invalidVerificationCode', { lang }));
        }

        // Clear code after successful use
        await this.redisService.get().del(key);

        // Find user
        const user = await this.userModel.findOne({ email });
        if (!user) {
            throw new UnauthorizedException(this.i18n.t('auth.error.userNotFound', { lang }));
        }

        // Validate password strength (at least 6 characters)
        if (password.length < 6) {
            throw new Error(this.i18n.t('auth.error.passwordTooShort', { lang }));
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Update user password
        user.password = hashedPassword;
        await user.save();

        return true;
    }

    async setPassword(userId: string, newPassword: string, lang: string = 'en'): Promise<void> {
        // Validate password strength
        if (newPassword.length < 6) {
            throw new Error(this.i18n.t('auth.error.passwordTooShort', { lang }));
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update user password
        await this.userModel.findByIdAndUpdate(userId, { 
            password: hashedPassword,
            $inc: { tokenVersion: 1 } 
        });
    }

    async loginWithThirdParty(platform: string, token: string, nickname?: string, lang: string = 'en'): Promise<{ token: string, user: UserDocument }> {
        let authId = token;
        let email: string | undefined;

        if (platform === 'apple') {
            try {
                // Verify Apple Identity Token
                const { sub, email: appleEmail } = await appleSignin.verifyIdToken(token, {
                    // Audience (Client ID) verification
                    audience: process.env.APPLE_CLIENT_ID,
                    ignoreExpiration: true, // For testing, set to false in production
                });
                authId = sub;
                email = appleEmail;
            } catch (error) {
                this.logger.error(`Apple Sign-In verification failed: ${error}`);
                throw new UnauthorizedException(this.i18n.t('auth.error.invalidAppleToken', { lang }));
            }
        }

        const user = await this.validateUserByThirdParty(platform, authId, email, nickname, lang);
        
        // Increment token version to invalidate old tokens
        user.tokenVersion = (user.tokenVersion || 0) + 1;
        await user.save();

        const jwt = this.generateToken(user);
        return { token: jwt, user };
    }

    async updateProfile(userId: string, updates: Partial<User>, lang: string = 'en'): Promise<UserDocument> {
        const user = await this.userModel.findByIdAndUpdate(
            userId,
            { $set: updates },
            { new: true }
        );
        if (!user) {
            throw new UnauthorizedException(this.i18n.t('auth.error.userNotFound', { lang }));
        }
        return user;
    }

    async logout(token: string): Promise<boolean> {
        // Blacklist the token in Redis
        // Use the same expiration time as the JWT (7 days = 604800 seconds)
        const key = `blacklist:${token}`;
        await this.redisService.get().setex(key, 604800, 'true');
        return true;
    }

    async isTokenBlacklisted(token: string): Promise<boolean> {
        const key = `blacklist:${token}`;
        const result = await this.redisService.get().get(key);
        return result === 'true';
    }

    async validateUserByThirdParty(platform: string, authId: string, email?: string, nickname?: string, lang: string = 'en'): Promise<UserDocument> {
        // Find existing user by authId and provider
        let user = await this.userModel.findOne({ authId, authProvider: platform });
        
        if (user && user.status === 'frozen') {
            throw new UnauthorizedException(this.i18n.t('auth.error.accountFrozen', { lang }));
        }

        // If not found, try finding by email (if provided) to link accounts
        if (!user && email) {
            user = await this.userModel.findOne({ email });
            if (user) {
                if (user.status === 'frozen') {
                    throw new UnauthorizedException(this.i18n.t('auth.error.accountFrozen', { lang }));
                }
                // Link existing account
                user.authId = authId;
                // If the existing user doesn't have an authProvider (e.g. only email login), 
                // we might want to keep it as 'email' or update it. 
                // For now, let's assume we just link the authId.
                if (!user.language) {
                    user.language = lang;
                }
                await user.save();
                return user;
            }
        }

        if (!user) {
            // Create new user
            user = new this.userModel({ 
                authId, 
                authProvider: platform,
                email: email, // Save email if available
                nickname: nickname, // Save nickname if available
                onboardingCompleted: false,
                language: lang,
            });
            await user.save();
            
            // Create trial subscription
            await this.billingService.createTrialSubscription(user.id);
        } else {
             // Update language for existing user only if not set
             if (!user.language) {
                 user.language = lang;
                 await user.save();
             }
        }
        return user;
    }

    generateToken(user: UserDocument): string {
        const payload = { 
            sub: user._id, 
            email: user.email,
            tokenVersion: user.tokenVersion 
        };
        return this.jwtService.sign(payload);
    }

    async registerDeviceToken(userId: string, token: string): Promise<boolean> {
        await this.userModel.findByIdAndUpdate(userId, {
            $addToSet: { deviceTokens: token }
        });
        return true;
    }

    async deactivateAccount(userId: string): Promise<boolean> {
        await this.userModel.findByIdAndUpdate(userId, { status: 'frozen' });
        return true;
    }
}
