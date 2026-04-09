"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loggingMiddleware = loggingMiddleware;
function loggingMiddleware(req, res, next) {
    const start = Date.now();
    res.on("finish", () => {
        const duration = Date.now() - start;
        console.log(`[${req.method}] ${req.path} ${res.statusCode} ${duration}ms`);
    });
    next();
}
//# sourceMappingURL=logging.js.map