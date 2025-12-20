import { Controller, Post, UploadedFile, UseInterceptors, Body } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import { StorageService } from '../storage/storage.service'
import { AiService } from '../ai/ai.service'

@Controller('vision')
export class VisionController {
  constructor(private readonly storage: StorageService, private readonly ai: AiService) {}

  @Post('upload-url')
  async getUploadUrl(@Body() body: { contentType: string }) {
    return this.storage.getSignedUploadUrl(body.contentType || 'image/jpeg')
  }

  @Post('ingredients')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 }
    })
  )
  async recognize(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { imageUrl?: string; timezone?: string }
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

    const items = await this.ai.recognizeIngredientsFromImage(url, 'zh')
    return { url, items }
  }
}

