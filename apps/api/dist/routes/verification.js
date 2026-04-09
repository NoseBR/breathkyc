"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const zod_1 = require("zod");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
// Default Mock B2B Client ID for testing (in a real app this is derived from x-api-key)
const MOCK_CLIENT_ID = 'clr...'; // We'll just create a dummy client if none exists
async function getOrCreateMockClient() {
    let client = await prisma.client.findFirst();
    if (!client) {
        client = await prisma.client.create({
            data: {
                name: 'Demo Client',
                email: 'demo@breath.id',
            }
        });
    }
    return client;
}
/** Strip zone index (e.g. fe80::1%en0) and IPv4-mapped IPv6. */
function stripIp(raw) {
    let ip = raw.split('%')[0] ?? raw;
    if (ip.startsWith('::ffff:'))
        ip = ip.slice(7);
    return ip.trim();
}
/** LAN / loopback clients cannot be resolved by public IP APIs — use BR mock for dev & phone-on-Wi‑Fi. */
function effectiveIpForGeoLookup(clientIp) {
    const ip = stripIp(clientIp);
    if (ip === '::1' || ip === '127.0.0.1' || !ip) {
        return '177.100.200.50';
    }
    if (ip.startsWith('10.') ||
        ip.startsWith('192.168.') ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(ip)) {
        return '177.100.200.50';
    }
    return ip;
}
// Haversine formula to calculate distance in km
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the earth in km
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
router.post('/start', async (req, res) => {
    try {
        const client = await getOrCreateMockClient();
        const verification = await prisma.verification.create({
            data: {
                clientId: client.id,
                expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 mins expiry
            }
        });
        res.json({ sessionId: verification.sessionId, expiresAt: verification.expiresAt });
    }
    catch (error) {
        console.error('Error starting session:', error);
        res.status(500).json({ error: 'Failed to start verification session' });
    }
});
const geoSchema = zod_1.z.object({
    sessionId: zod_1.z.string(),
    latitude: zod_1.z.number(),
    longitude: zod_1.z.number(),
});
router.post('/geolocation', async (req, res) => {
    try {
        const body = geoSchema.parse(req.body);
        let clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        if (Array.isArray(clientIp))
            clientIp = clientIp[0];
        clientIp = stripIp(typeof clientIp === 'string' ? clientIp : '');
        const lookupIp = effectiveIpForGeoLookup(clientIp);
        // Call ip-api.com (lookupIp is public; LAN phones use mocked BR IP above)
        let ipData = null;
        try {
            const resp = await fetch(`http://ip-api.com/json/${lookupIp}`);
            ipData = await resp.json();
        }
        catch (e) {
            console.error('IP Geolocation failed', e);
        }
        const allowedJurisdictions = ['Brazil', 'BR'];
        const isAllowedCountry = !ipData || ipData.status !== 'success'
            ? true
            : allowedJurisdictions.includes(ipData.country ?? '');
        let vpnDetected = false;
        let distance = 0;
        if (ipData && ipData.status === 'success' && ipData.lat != null && ipData.lon != null) {
            distance = calculateDistance(body.latitude, body.longitude, ipData.lat, ipData.lon);
            // Skip VPN distance check when we mocked the IP (same dev session as phone on LAN)
            const usedMockIp = lookupIp === '177.100.200.50' && clientIp !== lookupIp;
            if (!usedMockIp && distance > 500) {
                vpnDetected = true;
            }
        }
        const verification = await prisma.verification.findUnique({
            where: { sessionId: body.sessionId }
        });
        if (!verification) {
            return res.status(404).json({ error: 'Session not found' });
        }
        const geoResult = {
            ipCountry: ipData?.country,
            ipRegion: ipData?.regionName,
            gpsLocation: { lat: body.latitude, lng: body.longitude },
            distanceKm: Math.round(distance),
            vpnDetected,
            allowed: isAllowedCountry && !vpnDetected
        };
        await prisma.verification.update({
            where: { sessionId: body.sessionId },
            data: {
                geoResult: JSON.stringify(geoResult),
                status: geoResult.allowed ? 'IN_PROGRESS' : 'FAILED'
            }
        });
        res.json(geoResult);
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return res.status(400).json({ error: error.errors });
        }
        console.error('Geolocation logic error:', error);
        res.status(500).json({ error: 'Server error parsing geolocation' });
    }
});
exports.default = router;
