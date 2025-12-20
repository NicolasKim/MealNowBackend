import { Controller, Post, Body, Headers, HttpCode, HttpStatus, Logger, BadRequestException, Req } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Resend } from 'resend';
import { EmailService } from './email.service';
import { User, UserDocument } from '../auth/schemas/user.schema';

@Controller('webhooks/resend')
export class EmailController {
    private readonly logger = new Logger(EmailController.name);

    constructor(
        private readonly emailService: EmailService,
        @InjectModel(User.name) private userModel: Model<UserDocument>
    ) {}

    @Post()
    @HttpCode(HttpStatus.OK)
    async handleWebhook(@Req() req: any, @Body() body: any) {
        const rawBody = req.rawBody;
        if (!rawBody) {
            throw new BadRequestException('Missing raw body');
        }

        this.logger.debug(`Received Resend webhook event: ${rawBody.toString()}`);

        const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
        let payload;

        if (webhookSecret) {
            const resend = new Resend(process.env.RESEND_API_KEY);
            try {
                payload = resend.webhooks.verify({
                    payload: rawBody.toString(),
                    headers: {
                        'id': req.headers['svix-id'],
                        'timestamp': req.headers['svix-timestamp'],
                        'signature': req.headers['svix-signature'],
                    } as any,
                    webhookSecret,
                });
            } catch (e: any) {
                this.logger.error('Webhook verification failed', e);
                if (e.message?.includes('Missing required headers')) {
                    throw new BadRequestException('Missing required webhook headers. If testing locally without headers, unset RESEND_WEBHOOK_SECRET.');
                }
                throw new BadRequestException('Invalid webhook signature');
            }
        } else {
            this.logger.warn('RESEND_WEBHOOK_SECRET not set, skipping verification');
            payload = body;
        }

        const { type, data } = payload as any;

        this.logger.log(`Received Resend webhook event: ${type}`);

        switch (type) {
            case 'email.sent':
                this.handleEmailSent(data);
                break;
            case 'email.delivered':
                this.handleEmailDelivered(data);
                break;
            case 'email.delivery_delayed':
                this.handleEmailDeliveryDelayed(data);
                break;
            case 'email.complained':
                this.handleEmailComplained(data);
                break;
            case 'email.bounced':
                this.handleEmailBounced(data);
                break;
            case 'email.opened':
                this.handleEmailOpened(data);
                break;
            case 'email.clicked':
                this.handleEmailClicked(data);
                break;
            case 'email.received':
                this.handleEmailReceived(data);
                break;
            default:
                this.logger.warn(`Unhandled Resend event type: ${type}`);
        }

        return { success: true };
    }

    private handleEmailSent(data: any) {
        this.logger.log(`Email sent: ${data.email_id} to ${data.to}`);
    }

    private handleEmailDelivered(data: any) {
        this.logger.log(`Email delivered: ${data.email_id} to ${data.to}`);
    }

    private handleEmailDeliveryDelayed(data: any) {
        this.logger.warn(`Email delivery delayed: ${data.email_id} to ${data.to}`);
    }

    private handleEmailComplained(data: any) {
        this.logger.warn(`Email complaint received: ${data.email_id} from ${data.to}`);
    }

    private handleEmailBounced(data: any) {
        this.logger.error(`Email bounced: ${data.email_id} to ${data.to}. Type: ${data.bounce?.type}, Subtype: ${data.bounce?.subType}`);
    }

    private handleEmailOpened(data: any) {
        this.logger.log(`Email opened: ${data.email_id} by ${data.to}`);
    }

    private handleEmailClicked(data: any) {
        this.logger.log(`Email clicked: ${data.email_id} by ${data.to}. Link: ${data.click?.link}`);
    }

    private async handleEmailReceived(data: any) {
        this.logger.log(`Email received: ${data.email_id} from ${data.from}`);

        // Auto-reply to support emails
        const supportEmail = 'support@mail.mealnow.top';
        const recipients = Array.isArray(data.to) ? data.to : [data.to];
        
        if (recipients.includes(supportEmail)) {
            const sender = data.from;
            const subject = 'Re: ' + (data.subject || 'Your email');
            
            // Check if sender is an existing user to determine language
            const user = await this.userModel.findOne({ email: sender });
            const lang = user?.language || 'en';
            
            let html = '';
            let text = '';

            if (lang === 'zh') {
                html = `
                    <p>尊敬的用户，</p>
                    <p>我们已收到您的邮件，将尽快回复您。</p>
                    <br>
                    <p>致敬，</p>
                    <p>MealNow 支持团队</p>
                `;
                text = '尊敬的用户，\n\n我们已收到您的邮件，将尽快回复您。\n\n致敬，\nMealNow 支持团队';
            } else {
                html = `
                    <p>Dear user,</p>
                    <p>We have received your email and will get back to you as soon as possible.</p>
                    <br>
                    <p>Best regards,</p>
                    <p>The MealNow Support Team</p>
                `;
                text = 'Dear user,\n\nWe have received your email and will get back to you as soon as possible.\n\nBest regards,\nThe MealNow Support Team';
            }

            await this.emailService.sendEmail(sender, subject, html, text);
            this.logger.log(`Auto-reply sent to ${sender} in language: ${lang}`);
        }
    }
}
