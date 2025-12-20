import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UseGuards } from '@nestjs/common';
import { User, UserDocument } from '../auth/schemas/user.schema';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { I18nService } from 'nestjs-i18n';
import { CurrentClientInfo, ClientInfo } from '../../common/decorators/client-info.decorator';

import { PreferenceService } from './preference.service';

@Resolver()
export class PreferenceResolver {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private readonly i18n: I18nService,
    private readonly preferenceService: PreferenceService,
  ) { }

  @Query('tastePreferenceOptions')
  async getTastePreferenceOptions(@CurrentClientInfo() clientInfo: ClientInfo) {
    const lang = clientInfo.language;
    const options = await this.preferenceService.getAllPreferences();
    return options.map(option => ({
      ...option,
      // Fallback to English if translation for requested language is missing
      label: option.label[lang] || option.label['en'] || option.value,
    }));
  }

  @Mutation('completeOnboarding')
  @UseGuards(JwtAuthGuard)
  async completeOnboarding(
    @Args('tastePreferences') tastePreferences: string[],
    @CurrentUser() user: UserDocument,
    @CurrentClientInfo() clientInfo: ClientInfo,
  ) {
    const lang = clientInfo.language;
    const updatedUser = await this.userModel.findByIdAndUpdate(
      user._id,
      {
        tastePreferences,
        onboardingCompleted: true,
      },
      { new: true },
    );

    if (!updatedUser) {
      throw new Error(this.i18n.t('preference.errors.user_not_found', { lang }));
    }

    return updatedUser;
  }

  @Mutation('setPreferences')
  @UseGuards(JwtAuthGuard)
  async setPreferences(
    @Args('input')
    input: {
      spicyLevel: number;
      dietaryRestrictions: string[];
      dislikedIngredients: string[];
      cookTimeMin: number;
      cookTimeMax: number;
    },
    @CurrentUser() user: UserDocument,
  ) {
    // Ideally this would save to the user profile or a separate preferences collection
    // For now just returning input as per original code, but authenticated
    return input;
  }
}
