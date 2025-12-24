import { Controller, Post, UploadedFile, UseInterceptors, Body, UseGuards, Req } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import { StorageService } from '../storage/storage.service'
import { AiService } from '../ai/ai.service'
import { BillingService } from '../billing/billing.service'
import { JwtAuthRestGuard } from '../auth/guards/jwt-auth-rest.guard'
import { Request } from 'express'
import { UserDocument } from '../auth/schemas/user.schema'
import { I18nService } from 'nestjs-i18n'
import { QuotaExceededError } from '../../common/errors/quota-exceeded.error'

@Controller('vision')
export class VisionController {
  constructor(
    private readonly storage: StorageService,
    private readonly ai: AiService,
    private readonly billing: BillingService,
    private readonly i18n: I18nService
  ) {}

  @Post('upload-url')
  async getUploadUrl(@Body() body: { contentType: string }) {
    return this.storage.getSignedUploadUrl(body.contentType || 'image/jpeg')
  }

  @Post('ingredients')
  @UseGuards(JwtAuthRestGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 }
    })
  )
  async recognize(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { imageUrl?: string; timezone?: string },
    @Req() req: Request
  ) {
    let url = body.imageUrl
    const timezone = body.timezone

    if (file) {
      if (!/^image\/(jpeg|jpg|png)$/.test(file.mimetype)) {
        return { url: '', items: [] }
      }
      const result = await this.storage.uploadImage(file)
      url = result.url
    }

    if (!url) {
      return { url: '', items: [] }
    }

    const user = req.user as UserDocument
    const lang = user?.language || 'zh'

    const hasQuota = await this.billing.checkAndConsumeQuota(user._id.toString(), 'recognize_ingredients', lang)
    if (!hasQuota) {
      const message = this.i18n.t('recipe.errors.quota_exceeded', { lang })
      throw new QuotaExceededError(message)
    }

    const items = await this.ai.recognizeIngredientsFromImage(url, 'zh')

    return { url, items }
  }
}
