import { Injectable } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import * as Mustache from 'mustache';

@Injectable()
export class TemplateService {
  private readonly templateDir = path.join(process.cwd(), 'templates');

  constructor() {
    // 确保模板目录存在
    if (!fs.existsSync(this.templateDir)) {
      fs.mkdirSync(this.templateDir, { recursive: true });
    }
  }

  render(template: string, data: Record<string, any>): string {
    try {
      return Mustache.render(template, data);
    } catch (error: any) {
      throw new Error(`模板渲染失败: ${error.message}`);
    }
  }

  renderFromFile(fileName: string, data: Record<string, any>): string {
    const filePath = path.join(this.templateDir, fileName);
    
    if (!fs.existsSync(filePath)) {
      throw new Error(`模板文件不存在: ${fileName}`);
    }

    try {
      const template = fs.readFileSync(filePath, 'utf-8');
      return this.render(template, data);
    } catch (error: any) {
      // Re-throw if it's already our custom error from render
      if (error.message.startsWith('模板渲染失败')) {
        throw error;
      }
      throw new Error(`文件读取失败: ${error.message}`);
    }
  }
}
