"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dispatchWebhook = dispatchWebhook;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 5000, 15000]; // exponential backoff
async function dispatchWebhook(webhookUrl, payload) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            const response = await fetch(webhookUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(10000),
            });
            if (response.ok) {
                console.log(`[WEBHOOK] Delivered to ${webhookUrl} (attempt ${attempt + 1})`);
                return true;
            }
            console.warn(`[WEBHOOK] Failed ${webhookUrl} status=${response.status} (attempt ${attempt + 1})`);
        }
        catch (err) {
            console.error(`[WEBHOOK] Error delivering to ${webhookUrl} (attempt ${attempt + 1}):`, err instanceof Error ? err.message : err);
        }
        if (attempt < MAX_RETRIES - 1) {
            await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
        }
    }
    console.error(`[WEBHOOK] Exhausted retries for ${webhookUrl}`);
    return false;
}
//# sourceMappingURL=webhook.js.map