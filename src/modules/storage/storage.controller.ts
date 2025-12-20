import { Controller, Post, UploadedFile, UseInterceptors, UseGuards, Body } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { StorageService } from './storage.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('storage')
export class StorageController {
    constructor(private readonly storageService: StorageService) { }

    @Post('upload-url')
    @UseGuards(JwtAuthGuard)
    async getUploadUrl(@Body() body: { contentType: string }) {
        return this.storageService.getSignedUploadUrl(body.contentType || 'image/jpeg')
    }

    @Post('upload')
    @UseGuards(JwtAuthGuard)
    @UseInterceptors(FileInterceptor('file'))
    async uploadFile(@UploadedFile() file: Express.Multer.File) {
        return this.storageService.uploadImage(file);
    }
}
