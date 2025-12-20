import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { I18nService } from 'nestjs-i18n';

@Injectable()
export class EmailService {
    private readonly logger = new Logger(EmailService.name);
    private resend: Resend;

    constructor(private readonly i18n: I18nService) {
        this.resend = new Resend(process.env.RESEND_API_KEY);
    }

    async sendEmail(to: string, subject: string, html: string, text?: string): Promise<boolean> {
        try {
            const data = await this.resend.emails.send({
                from: `${process.env.SMTP_FROM_NAME || 'Support'} <${process.env.SMTP_FROM}>`,
                to,
                subject,
                html,
                text,
            });

            if (data.error) {
                this.logger.error(`Error sending email to ${to}: ${data.error.message}`, data.error.name);
                return false;
            }

            this.logger.log(`Email sent to ${to}, Message ID: ${data.data?.id}`);
            return true;
        } catch (error: any) {
            this.logger.error(`Failed to send email to ${to}`, error.stack);
            return false;
        }
    }

    async sendVerificationEmail(to: string, code: string, lang: string = 'en'): Promise<boolean> {
        try {
            const senderName = this.i18n.t('email.sender_name', { lang });
            const subject = this.i18n.t('email.verification.subject', { lang });
            const title = this.i18n.t('email.verification.title', { lang });
            const message = this.i18n.t('email.verification.message', { lang });
            const expiry = this.i18n.t('email.verification.expiry', { lang });
            const ignore = this.i18n.t('email.verification.ignore', { lang });

            const data = await this.resend.emails.send({
                from: `${senderName} <${process.env.SMTP_FROM}>`,
                to,
                subject,
                html: `
                    <div style="font-family: Arial, sans-serif; padding: 20px;">
                        <h2>${title}</h2>
                        <p>${message}</p>
                        <h1 style="color: #4CAF50; letter-spacing: 5px;">${code}</h1>
                        <p>${expiry}</p>
                        <p>${ignore}</p>
                    </div>
                `,
            });

            if (data.error) {
                this.logger.error(`Error sending email to ${to}: ${data.error.message}`, data.error.name);
                return false;
            }

            this.logger.log(`Verification email sent to ${to}, Message ID: ${data.data?.id}`);
            return true;
        } catch (error: any) {
            this.logger.error(`Failed to send email to ${to}`, error.stack);
            return false;
        }
    }
}
