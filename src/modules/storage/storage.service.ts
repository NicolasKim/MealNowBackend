import { Injectable } from '@nestjs/common'
import { createHash } from 'crypto'
import * as path from 'path'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

type UploadResult = { url: string; key: string }

@Injectable()
export class StorageService {
  private bucket = process.env.SUPABASE_BUCKET || 'ingredients'
  private supabaseUrl = process.env.SUPABASE_URL || ''
  private supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  private client?: SupabaseClient
  private bucketReady = false

  constructor() {
    if (this.supabaseUrl && this.supabaseKey) {
      this.client = createClient(this.supabaseUrl, this.supabaseKey)
    }
  }

  async uploadImage(file: Express.Multer.File): Promise<UploadResult> {
    return this.uploadBuffer(file.buffer, file.mimetype)
  }

  async getSignedUploadUrl(contentType: string): Promise<{ uploadUrl: string; publicUrl: string; key: string }> {
    if (!this.client) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    }

    const ext = this.getExt(contentType)
    const now = new Date()
    const yyyy = String(now.getFullYear())
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    const dd = String(now.getDate()).padStart(2, '0')
    const randomId = Math.random().toString(36).substring(2, 15)
    const key = path.posix.join('ingredients', yyyy, mm, dd, `${randomId}-${Date.now()}.${ext}`)

    if (!this.bucketReady) {
      await this.ensureBucket()
      this.bucketReady = true
    }

    const { data, error } = await this.client.storage
      .from(this.bucket)
      .createSignedUploadUrl(key)

    if (error) {
      throw error
    }

    const { data: publicData } = this.client.storage.from(this.bucket).getPublicUrl(key)

    return {
      uploadUrl: data.signedUrl,
      publicUrl: publicData.publicUrl,
      key
    }
  }

  async uploadBuffer(buffer: Buffer, mimetype: string): Promise<UploadResult> {
    if (!this.client) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    }
    
    const ext = this.getExt(mimetype)
    const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16)
    const now = new Date()
    const yyyy = String(now.getFullYear())
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    const dd = String(now.getDate()).padStart(2, '0')
    const key = path.posix.join('ingredients', yyyy, mm, dd, `${hash}-${Date.now()}.${ext}`)
    if (!this.bucketReady) {
      await this.ensureBucket()
      this.bucketReady = true
    }
    const upload = await this.client.storage.from(this.bucket).upload(key, buffer, {
      contentType: mimetype,
      upsert: false
    })
    if (upload.error) {
      throw upload.error
    }
    const pub = this.client.storage.from(this.bucket).getPublicUrl(key)
    const url = pub.data.publicUrl
    return { url, key }
  }

  private getExt(mime: string) {
    if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg'
    if (mime === 'image/png') return 'png'
    return 'bin'
  }

  private async ensureBucket() {
    if (!this.client) return
    const exists = await this.client.storage.listBuckets()
    const found = exists.data?.some(b => b.name === this.bucket)
    if (!found) {
      await this.client.storage.createBucket(this.bucket, { public: true })
    }
  }
}
