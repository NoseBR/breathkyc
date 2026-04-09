interface WebhookPayload {
    sessionId: string;
    status: string;
    overallScore: number | null;
    completedAt: string | null;
}
export declare function dispatchWebhook(webhookUrl: string, payload: WebhookPayload): Promise<boolean>;
export {};
//# sourceMappingURL=webhook.d.ts.map